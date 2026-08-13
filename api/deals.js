// =============================================================================
// /api/deals.js — Vercel Serverless Function (Modular & Robusto)
// -----------------------------------------------------------------------------
// 1. Busca preços atuais via Travelpayouts /v2/prices/latest
// 2. Normaliza campos (value/price, number_of_changes/transfers, códigos metro como SAO/RIO)
// 3. Compara com média ponderada histórica dos últimos 3 meses (/v1/prices/cheap)
// 4. Retorna promoções reais (desconto >= 5%) ou fallback com os menores preços normais
// =============================================================================

const AIRPORT_NAMES = {
  // Códigos metropolitanos e de cidades (muito comuns na API)
  SAO: "São Paulo", RIO: "Rio de Janeiro", BHZ: "Belo Horizonte",
  BUE: "Buenos Aires", NYC: "Nova York", LON: "Londres",
  PAR: "Paris", ROM: "Roma", MIL: "Milão", CHI: "Chicago",
  WAS: "Washington",

  // Brasil — Sudeste
  GRU: "São Paulo (Guarulhos)", CGH: "São Paulo (Congonhas)", VCP: "Campinas (Viracopos)",
  GIG: "Rio de Janeiro (Galeão)", SDU: "Rio de Janeiro (Santos Dumont)",
  BSB: "Brasília", CNF: "Belo Horizonte (Confins)", PLU: "Belo Horizonte (Pampulha)",
  VIX: "Vitória",

  // Brasil — Sul
  POA: "Porto Alegre", CWB: "Curitiba", FLN: "Florianópolis",
  IGU: "Foz do Iguaçu", JOI: "Joinville", NVT: "Navegantes",
  LDB: "Londrina", MGF: "Maringá",

  // Brasil — Centro-Oeste
  CGB: "Cuiabá", CGR: "Campo Grande", PMW: "Palmas", GYN: "Goiânia",

  // Brasil — Nordeste
  REC: "Recife", SSA: "Salvador", FOR: "Fortaleza", NAT: "Natal",
  MCZ: "Maceió", SLZ: "São Luís", THE: "Teresina",
  AJU: "Aracaju", JPA: "João Pessoa",

  // Brasil — Norte
  BEL: "Belém", MAO: "Manaus", PVH: "Porto Velho",
  BVB: "Boa Vista", MCP: "Macapá", RBR: "Rio Branco",

  // Portugal
  LIS: "Lisboa", OPO: "Porto",

  // América do Norte
  MIA: "Miami", MCO: "Orlando", JFK: "Nova York (JFK)",
  EWR: "Nova York (Newark)", LAX: "Los Angeles", ORD: "Chicago", CUN: "Cancún",

  // América do Sul
  EZE: "Buenos Aires (Ezeiza)", AEP: "Buenos Aires (Aeroparque)",
  SCL: "Santiago", LIM: "Lima", BOG: "Bogotá",
  MVD: "Montevidéu", ASU: "Assunção",

  // Europa
  MAD: "Madri", BCN: "Barcelona",
  CDG: "Paris (Charles de Gaulle)", ORY: "Paris (Orly)",
  LHR: "Londres (Heathrow)", LGW: "Londres (Gatwick)",
  FCO: "Roma (Fiumicino)", MXP: "Milão (Malpensa)",
  AMS: "Amsterdã", FRA: "Frankfurt",

  // Outros
  DXB: "Dubai", NRT: "Tóquio",
};

const BR_AIRPORTS = new Set([
  "SAO","RIO","BHZ","BSB","GYN",
  "GRU","CGH","VCP","GIG","SDU","CNF","PLU","VIX",
  "POA","CWB","FLN","IGU","JOI","NVT","LDB","MGF",
  "CGB","CGR","PMW",
  "REC","SSA","FOR","NAT","MCZ","SLZ","THE","AJU","JPA",
  "BEL","MAO","PVH","BVB","MCP","RBR"
]);

const cityName = code => AIRPORT_NAMES[code] || code;

function getDealTier(pct) {
  if (pct >= 30) return { key: "hot",   label: "Imperdível",       emoji: "🔥" };
  if (pct >= 15) return { key: "good",  label: "Boa oferta",       emoji: "✅" };
  if (pct >=  5) return { key: "below", label: "Abaixo do normal", emoji: "📉" };
  return null;
}

function affiliateLink(path, origin, destination, date, marker) {
  const base = "https://www.aviasales.com";
  if (path) {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    return marker ? `${url}${url.includes("?") ? "&" : "?"}marker=${marker}` : url;
  }
  if (origin && destination && date) {
    const [, m, d] = date.split("-");
    const search = `${origin}${d || "01"}${m || "01"}${destination}1`;
    return marker ? `${base}/search/${search}?marker=${marker}` : `${base}/search/${search}`;
  }
  return marker ? `${base}?marker=${marker}` : base;
}

function fmtDate(str) {
  if (!str) return "";
  try {
    return new Date(str + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return str; }
}

// Busca média dos últimos 3 meses com pesos decrescentes
async function fetchHistorical(origin, destination, token) {
  const now = new Date();
  const monthJobs = [1, 2, 3].map(async (back) => {
    const d  = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const qs = new URLSearchParams({ origin, destination, depart_date: ym, currency: "brl" });
    try {
      const res = await fetch(
        `https://api.travelpayouts.com/v1/prices/cheap?${qs}`,
        { headers: { "X-Access-Token": token }, signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return { weight: 4 - back, prices: [] };
      const json   = await res.json();
      const bucket = json.data?.[destination] || {};
      const prices = Object.values(bucket)
        .map(t => Number(t.price ?? t.value ?? 0))
        .filter(p => p > 0);
      return { weight: 4 - back, prices };
    } catch {
      return { weight: 1, prices: [] };
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
  // CDN Cache de 5 minutos
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

  const token  = process.env.TRAVELPAYOUTS_TOKEN;
  const marker = process.env.TRAVELPAYOUTS_MARKER || "";

  if (!token) {
    return res.status(500).json({ success: false, error: "TRAVELPAYOUTS_TOKEN não configurado." });
  }

  const origin = (req.query.origin || "GRU").toUpperCase();
  const destination = req.query.destination && req.query.destination !== "ANY"
    ? req.query.destination.toUpperCase()
    : null;

  try {
    const qs = new URLSearchParams({
      currency: "brl",
      origin,
      sorting: "price",
      limit: "30",
      one_way: "false",
    });
    if (destination) qs.set("destination", destination);

    const curRes = await fetch(
      `https://api.travelpayouts.com/v2/prices/latest?${qs}`,
      { headers: { "X-Access-Token": token }, signal: AbortSignal.timeout(8000) }
    );

    if (!curRes.ok) {
      return res.status(curRes.status).json({ success: false, error: `API Travelpayouts retornou ${curRes.status}` });
    }

    const rawData = (await curRes.json()).data;
    if (!Array.isArray(rawData) || !rawData.length) {
      return res.status(200).json({
        success: true,
        data: [],
        normalFallback: [],
        meta: { total: 0, origin, destination: destination || "ANY", updatedAt: new Date().toISOString() }
      });
    }

    // Normalizar itens para garantir campos numéricos consistentes (evita NaN)
    const rows = rawData
      .map(r => {
        const price = Number(r.value ?? r.price ?? 0);
        const transfers = Number(r.number_of_changes ?? r.transfers ?? 0);
        return {
          origin: r.origin,
          destination: r.destination,
          depart_date: r.depart_date || "",
          price,
          transfers,
          airline: r.airline || null,
          link: r.link || null,
        };
      })
      .filter(r => r.price > 0 && r.origin && r.destination);

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        data: [],
        normalFallback: [],
        meta: { total: 0, origin, destination: destination || "ANY", updatedAt: new Date().toISOString() }
      });
    }

    // Obter rotas únicas para histórico
    const seen = new Set();
    const routes = [];
    for (const r of rows) {
      const k = `${r.origin}|${r.destination}`;
      if (!seen.has(k) && routes.length < 12) {
        seen.add(k);
        routes.push({ o: r.origin, d: r.destination });
      }
    }

    // Buscar histórico das rotas
    const baseMap = {};
    await Promise.allSettled(
      routes.map(async ({ o, d }) => {
        baseMap[`${o}|${d}`] = await fetchHistorical(o, d, token);
      })
    );

    // Mediana para fallback
    const sortedPrices = [...rows].map(r => r.price).sort((a, b) => a - b);
    const medianPrice  = sortedPrices[Math.floor(sortedPrices.length / 2)] || rows[0].price;
    const fallbackBase = Math.round(medianPrice * 1.25);

    // Mapear ofertas promocionais
    const deals = rows
      .map(r => {
        const key = `${r.origin}|${r.destination}`;
        const hist = baseMap[key] || fallbackBase;
        const isEstimated = !baseMap[key];

        if (r.price >= hist) return null;
        const pct = Math.round(100 - (r.price / hist * 100));
        const tier = getDealTier(pct);
        if (!tier) return null;

        const isBr = BR_AIRPORTS.has(r.origin) && BR_AIRPORTS.has(r.destination);

        return {
          from:          cityName(r.origin),
          fromCode:      r.origin,
          to:            cityName(r.destination),
          toCode:        r.destination,
          date:          r.depart_date,
          dateFormatted: fmtDate(r.depart_date),
          price:         r.price,
          historicalAvg: hist,
          discountPct:   pct,
          isEstimated,
          tier,
          transfers:     r.transfers,
          airline:       r.airline,
          link:          affiliateLink(r.link, r.origin, r.destination, r.depart_date, marker),
          tag:           isBr ? "nacional" : "internacional",
          isNormalPrice: false,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.discountPct - a.discountPct);

    // Voos mais baratos regulares caso não haja promoção na rota
    const normalFallback = deals.length ? [] : rows
      .slice(0, 6)
      .map(r => {
        const isBr = BR_AIRPORTS.has(r.origin) && BR_AIRPORTS.has(r.destination);
        return {
          from:          cityName(r.origin),
          fromCode:      r.origin,
          to:            cityName(r.destination),
          toCode:        r.destination,
          date:          r.depart_date,
          dateFormatted: fmtDate(r.depart_date),
          price:         r.price,
          historicalAvg: baseMap[`${r.origin}|${r.destination}`] || null,
          discountPct:   0,
          isNormalPrice: true,
          tier:          null,
          transfers:     r.transfers,
          airline:       r.airline,
          link:          affiliateLink(r.link, r.origin, r.destination, r.depart_date, marker),
          tag:           isBr ? "nacional" : "internacional",
        };
      });

    return res.status(200).json({
      success: true,
      data: deals,
      normalFallback,
      meta: {
        total: deals.length,
        origin,
        destination: destination || "ANY",
        updatedAt: new Date().toISOString(),
      },
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: "Erro interno ao processar ofertas." });
  }
}
