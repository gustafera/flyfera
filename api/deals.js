// =============================================================================
// /api/deals.js — Vercel Serverless Function v2
// -----------------------------------------------------------------------------
// Lógica de comparação histórica real:
//   1. Busca preços atuais via /v2/prices/latest
//   2. Para cada rota encontrada, busca preços dos últimos 3 meses via
//      /v1/prices/cheap (em paralelo, com timeout por chamada)
//   3. Calcula média ponderada (mês mais recente tem peso maior)
//   4. Só retorna deals com desconto >= 5% vs. a média histórica
//   5. Classifica em 3 tiers: Imperdível (≥30%), Boa oferta (≥15%), Abaixo do normal (≥5%)
//
// Variáveis de ambiente necessárias no Vercel:
//   TRAVELPAYOUTS_TOKEN  — token de API (obrigatório)
//   TRAVELPAYOUTS_MARKER — ID de afiliado para links (opcional, mas necessário para comissão)
// =============================================================================

const AIRPORT_NAMES = {
  // Brasil — Sudeste
  GRU:"São Paulo", CGH:"São Paulo", VCP:"Campinas",
  GIG:"Rio de Janeiro", SDU:"Rio de Janeiro",
  BSB:"Brasília", CNF:"Belo Horizonte", PLU:"Belo Horizonte",
  VIX:"Vitória",
  // Brasil — Sul
  POA:"Porto Alegre", CWB:"Curitiba", FLN:"Florianópolis",
  IGU:"Foz do Iguaçu", JOI:"Joinville", NVT:"Navegantes",
  LDB:"Londrina", MGF:"Maringá",
  // Brasil — Centro-Oeste
  CGB:"Cuiabá", CGR:"Campo Grande", PMW:"Palmas",
  // Brasil — Nordeste
  REC:"Recife", SSA:"Salvador", FOR:"Fortaleza", NAT:"Natal",
  MCZ:"Maceió", SLZ:"São Luís", THE:"Teresina",
  AJU:"Aracaju", JPA:"João Pessoa",
  // Brasil — Norte
  BEL:"Belém", MAO:"Manaus", PVH:"Porto Velho",
  BVB:"Boa Vista", MCP:"Macapá", RBR:"Rio Branco",
  // Portugal
  LIS:"Lisboa", OPO:"Porto",
  // EUA / América do Norte
  MIA:"Miami", MCO:"Orlando", JFK:"Nova York",
  EWR:"Nova York", LAX:"Los Angeles", ORD:"Chicago", CUN:"Cancún",
  // América do Sul
  EZE:"Buenos Aires", AEP:"Buenos Aires",
  SCL:"Santiago", LIM:"Lima", BOG:"Bogotá",
  MVD:"Montevidéu", ASU:"Assunção",
  // Europa
  MAD:"Madri", BCN:"Barcelona",
  CDG:"Paris", ORY:"Paris",
  LHR:"Londres", LGW:"Londres",
  FCO:"Roma", MXP:"Milão",
  AMS:"Amsterdã", FRA:"Frankfurt",
  // Outros
  DXB:"Dubai", NRT:"Tóquio",
};

const BR_AIRPORTS = new Set([
  "GRU","CGH","VCP","GIG","SDU","BSB","CNF","PLU","VIX",
  "POA","CWB","FLN","IGU","JOI","NVT","LDB","MGF",
  "CGB","CGR","PMW",
  "REC","SSA","FOR","NAT","MCZ","SLZ","THE","AJU","JPA",
  "BEL","MAO","PVH","BVB","MCP","RBR",
]);

const cityName = code => AIRPORT_NAMES[code] || code;

function getDealTier(pct) {
  if (pct >= 30) return { key:"hot",   label:"Imperdível",       emoji:"🔥" };
  if (pct >= 15) return { key:"good",  label:"Boa oferta",       emoji:"✅" };
  if (pct >=  5) return { key:"below", label:"Abaixo do normal", emoji:"📉" };
  return null;
}

function affiliateLink(path, origin, destination, date, marker) {
  const base = "https://www.aviasales.com";
  // If the API returned a ready-made search path (e.g. /search/GRU1209LIS1), use it
  if (path) {
    const url = `${base}${path}`;
    return marker ? `${url}?marker=${marker}` : url;
  }
  // Fallback: build a search URL from route info
  if (origin && destination && date) {
    const [, m, d] = date.split("-"); // "2026-10-12" → d="12", m="10"
    const search = `${origin}${d}${m}${destination}1`;
    return marker ? `${base}/search/${search}?marker=${marker}` : `${base}/search/${search}`;
  }
  return marker ? `${base}?marker=${marker}` : base;
}

function fmtDate(str) {
  if (!str) return "";
  try {
    return new Date(str + "T12:00:00").toLocaleDateString("pt-BR", {
      day:"2-digit", month:"short", year:"numeric",
    });
  } catch { return str; }
}

// Busca preços históricos de uma rota nos últimos 3 meses.
// Retorna média ponderada (mês mais recente = peso 3, mais antigo = peso 1).
async function fetchHistorical(origin, destination, token) {
  const now = new Date();

  const monthJobs = [1, 2, 3].map(async (back) => {
    const d  = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const qs = new URLSearchParams({ origin, destination, depart_date: ym, currency:"brl" });
    try {
      const res = await fetch(
        `https://api.travelpayouts.com/v1/prices/cheap?${qs}`,
        { headers:{ "X-Access-Token": token }, signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return { weight: 4 - back, prices:[] };
      const json   = await res.json();
      const bucket = json.data?.[destination] || {};
      const prices = Object.values(bucket).map(t => t.price).filter(p => p > 0);
      return { weight: 4 - back, prices };          // back=1 → weight=3, back=3 → weight=1
    } catch {
      return { weight: 1, prices:[] };
    }
  });

  const results = await Promise.allSettled(monthJobs);

  let wSum = 0, wTotal = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { weight, prices } = r.value;
    if (!prices.length) continue;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    wSum   += avg * weight;
    wTotal += weight;
  }
  return wTotal ? Math.round(wSum / wTotal) : null;
}

export default async function handler(req, res) {
  // Cache CDN: 5 min, serve stale por mais 1 min enquanto revalida em background
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

  const token  = process.env.TRAVELPAYOUTS_TOKEN;
  const marker = process.env.TRAVELPAYOUTS_MARKER || "";

  if (!token) {
    return res.status(500).json({ success:false, error:"TRAVELPAYOUTS_TOKEN não configurado." });
  }

  const origin = (req.query.origin || "GRU").toUpperCase();
  const destination = req.query.destination && req.query.destination !== "ANY"
    ? req.query.destination.toUpperCase()
    : null;

  try {
    // ── Passo 1: preços atuais ─────────────────────────────────────────────
    const qs = new URLSearchParams({
      currency:"brl", origin, sorting:"price", limit:"30", one_way:"false",
    });
    if (destination) qs.set("destination", destination);

    const curRes = await fetch(
      `https://api.travelpayouts.com/v2/prices/latest?${qs}`,
      { headers:{ "X-Access-Token": token }, signal: AbortSignal.timeout(8000) }
    );
    if (!curRes.ok) {
      return res.status(curRes.status).json({ success:false, error:`API respondeu ${curRes.status}` });
    }

    const rows = (await curRes.json()).data;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(200).json({ success:true, data:[], meta:{ total:0, updatedAt: new Date().toISOString() } });
    }

    // ── Passo 2: rotas únicas (máx 12) ────────────────────────────────────
    const seen = new Set();
    const routes = [];
    for (const r of rows) {
      const k = `${r.origin}|${r.destination}`;
      if (!seen.has(k) && routes.length < 12) { seen.add(k); routes.push({ o: r.origin, d: r.destination }); }
    }

    // ── Passo 3: histórico em paralelo ────────────────────────────────────
    const baseMap = {};
    await Promise.allSettled(
      routes.map(async ({ o, d }) => {
        baseMap[`${o}|${d}`] = await fetchHistorical(o, d, token);
      })
    );

    // ── Passo 4: enriquecer, filtrar e ordenar ────────────────────────────
    // Fallback baseline: mediana dos preços atuais × 1.25
    // Usado quando o endpoint histórico não retorna dados para uma rota específica.
    const sortedPrices = [...rows].map(r => r.price).sort((a, b) => a - b);
    const medianPrice  = sortedPrices[Math.floor(sortedPrices.length / 2)];
    const fallbackBase = Math.round(medianPrice * 1.25);

    const deals = rows
      .map(r => {
        const key  = `${r.origin}|${r.destination}`;
        // Usa histórico real se disponível, senão usa fallback baseado nos preços atuais
        const hist = baseMap[key] || fallbackBase;
        const isEstimated = !baseMap[key]; // true = baseline estimado, não histórico real

        if (r.price >= hist) return null;  // preço não está abaixo da baseline
        const pct  = Math.round(100 - (r.price / hist * 100));
        const tier = getDealTier(pct);
        if (!tier) return null;            // desconto < 5%
        return {
          from:          cityName(r.origin),
          fromCode:      r.origin,
          to:            cityName(r.destination),
          toCode:        r.destination,
          date:          r.depart_date || "",
          dateFormatted: fmtDate(r.depart_date),
          price:         r.price,
          historicalAvg: hist,
          discountPct:   pct,
          isEstimated,
          tier,
          transfers:     r.transfers ?? 0,
          airline:       r.airline || null,
          link:          affiliateLink(r.link, r.origin, r.destination, r.depart_date, marker),
          tag:           BR_AIRPORTS.has(r.origin) && BR_AIRPORTS.has(r.destination)
                           ? "nacional" : "internacional",
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.discountPct - a.discountPct);

    return res.status(200).json({
      success: true,
      data:    deals,
      meta: {
        total:     deals.length,
        origin,
        destination: destination || "ANY",
        updatedAt:   new Date().toISOString(),
        period:      "Média ponderada dos últimos 3 meses",
      },
    });

  } catch {
    return res.status(500).json({ success:false, error:"Erro interno ao buscar preços." });
  }
}
