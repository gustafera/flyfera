// =============================================================================
// /api/deals.js — Vercel Serverless Function (Foco Brasil & Reais R$)
// -----------------------------------------------------------------------------
// 1. Suporte preciso a 'Só Ida' (one_way=true) e 'Ida e Volta' (one_way=false)
// 2. Priorização da data solicitada pelo usuário (ex: 27/08)
// 3. Links com moeda BRL e idioma pt-BR
// 4. Mapeamento de companhias aéreas brasileiras (LATAM, GOL, Azul, Voepass)
// =============================================================================

const AIRPORT_NAMES = {
  SAO: "São Paulo", RIO: "Rio de Janeiro", BHZ: "Belo Horizonte",
  BUE: "Buenos Aires", NYC: "Nova York", LON: "Londres",
  PAR: "Paris", ROM: "Roma", MIL: "Milão", CHI: "Chicago",

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

  // Internacional
  LIS: "Lisboa", OPO: "Porto", MIA: "Miami", MCO: "Orlando",
  JFK: "Nova York", EZE: "Buenos Aires", SCL: "Santiago",
  LIM: "Lima", BOG: "Bogotá", MVD: "Montevidéu", MAD: "Madri",
  BCN: "Barcelona", CDG: "Paris", LHR: "Londres", FCO: "Roma"
};

const BR_AIRPORTS = new Set([
  "SAO","RIO","BHZ","BSB","GYN",
  "GRU","CGH","VCP","GIG","SDU","CNF","PLU","VIX",
  "POA","CWB","FLN","IGU","JOI","NVT","LDB","MGF",
  "CGB","CGR","PMW",
  "REC","SSA","FOR","NAT","MCZ","SLZ","THE","AJU","JPA",
  "BEL","MAO","PVH","BVB","MCP","RBR"
]);

const AIRLINE_NAMES = {
  G3: "GOL Linhas Aéreas",
  LA: "LATAM Airlines",
  JJ: "LATAM Airlines",
  AD: "Azul Linhas Aéreas",
  "2Z": "Voepass",
  TP: "TAP Air Portugal",
  AA: "American Airlines",
  AF: "Air France",
  IB: "Iberia",
  AR: "Aerolíneas Argentinas",
  AV: "Avianca",
  DL: "Delta Air Lines",
  UA: "United Airlines",
  CM: "Copa Airlines"
};

const cityName = code => AIRPORT_NAMES[code] || code;

function getAirlineName(code, isNational) {
  if (code && AIRLINE_NAMES[code]) return AIRLINE_NAMES[code];
  if (code) return `Cia. ${code}`;
  return isNational ? "LATAM / GOL / Azul" : "Companhia Aérea";
}

function getDealTier(pct) {
  if (pct >= 30) return { key: "hot",   label: "Imperdível",       emoji: "🔥" };
  if (pct >= 15) return { key: "good",  label: "Boa oferta",       emoji: "✅" };
  if (pct >=  5) return { key: "below", label: "Abaixo do normal", emoji: "📉" };
  return null;
}

// Gera link para o Aviasales forçando moeda BRL e idioma pt
function buildAviasalesLink(origin, destination, departDate, returnDate, marker) {
  const base = "https://www.aviasales.com";
  const params = new URLSearchParams();
  params.set("currency", "BRL");
  params.set("locale", "pt");
  if (marker) params.set("marker", marker);

  if (origin && destination && departDate) {
    const pDep = departDate.split("-");
    const dDep = pDep[2] || "01";
    const mDep = pDep[1] || "01";

    let segment = `${origin}${dDep}${mDep}${destination}`;
    if (returnDate) {
      const pRet = returnDate.split("-");
      const dRet = pRet[2] || "01";
      const mRet = pRet[1] || "01";
      segment += `${dRet}${mRet}`;
    }
    segment += "1"; // 1 passageiro

    return `${base}/search/${segment}?${params.toString()}`;
  }

  return `${base}?${params.toString()}`;
}

function fmtDate(str) {
  if (!str) return "";
  try {
    return new Date(str + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return str; }
}

// Histórico ponderado dos últimos 3 meses
async function fetchHistorical(origin, destination, isOneWay, token) {
  const now = new Date();
  const monthJobs = [1, 2, 3].map(async (back) => {
    const d  = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const qs = new URLSearchParams({
      origin,
      destination,
      depart_date: ym,
      currency: "brl",
      one_way: isOneWay ? "true" : "false"
    });
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
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=60");

  const token  = process.env.TRAVELPAYOUTS_TOKEN;
  const marker = process.env.TRAVELPAYOUTS_MARKER || "";

  if (!token) {
    return res.status(500).json({ success: false, error: "TRAVELPAYOUTS_TOKEN não configurado." });
  }

  const origin = (req.query.origin || "GRU").toUpperCase();
  const destination = req.query.destination && req.query.destination !== "ANY"
    ? req.query.destination.toUpperCase()
    : null;
  const reqDepartDate = req.query.depart_date || null;
  const reqReturnDate = req.query.return_date || null;
  const isOneWay = req.query.one_way !== "false"; // padrão Só Ida se não especificado

  try {
    const qs = new URLSearchParams({
      currency: "brl",
      origin,
      sorting: "price",
      limit: "40",
      one_way: isOneWay ? "true" : "false",
    });
    if (destination) qs.set("destination", destination);
    if (reqDepartDate) {
      qs.set("beginning_of_period", reqDepartDate);
    }

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

    // Normalizar itens
    let rows = rawData
      .map(r => {
        const price = Number(r.value ?? r.price ?? 0);
        const transfers = Number(r.number_of_changes ?? r.transfers ?? 0);
        const departDate = r.depart_date || "";

        let daysDiff = 0;
        let isExactDate = false;
        if (reqDepartDate && departDate) {
          const reqD = new Date(reqDepartDate + "T12:00:00");
          const curD = new Date(departDate + "T12:00:00");
          daysDiff = Math.round(Math.abs((curD - reqD) / (1000 * 60 * 60 * 24)));
          isExactDate = (daysDiff === 0);
        }

        const isNational = BR_AIRPORTS.has(r.origin) && BR_AIRPORTS.has(r.destination);

        return {
          origin: r.origin,
          destination: r.destination,
          depart_date: departDate,
          return_date: r.return_date || null,
          price,
          transfers,
          airline: r.airline || null,
          airlineName: getAirlineName(r.airline, isNational),
          daysDiff,
          isExactDate,
          isNational,
        };
      })
      .filter(r => r.price > 0 && r.origin && r.destination);

    // Se o usuário selecionou uma data, priorizar as datas mais próximas
    if (reqDepartDate) {
      const nearRows = rows.filter(r => r.daysDiff <= 30);
      if (nearRows.length) {
        rows = nearRows.sort((a, b) => a.daysDiff - b.daysDiff || a.price - b.price);
      } else {
        rows = rows.sort((a, b) => a.daysDiff - b.daysDiff || a.price - b.price);
      }
    }

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        data: [],
        normalFallback: [],
        meta: { total: 0, origin, destination: destination || "ANY", updatedAt: new Date().toISOString() }
      });
    }

    // Histórico de rotas
    const seen = new Set();
    const routes = [];
    for (const r of rows) {
      const k = `${r.origin}|${r.destination}`;
      if (!seen.has(k) && routes.length < 12) {
        seen.add(k);
        routes.push({ o: r.origin, d: r.destination });
      }
    }

    const baseMap = {};
    await Promise.allSettled(
      routes.map(async ({ o, d }) => {
        baseMap[`${o}|${d}`] = await fetchHistorical(o, d, isOneWay, token);
      })
    );

    const sortedPrices = [...rows].map(r => r.price).sort((a, b) => a - b);
    const medianPrice  = sortedPrices[Math.floor(sortedPrices.length / 2)] || rows[0].price;
    const fallbackBase = Math.round(medianPrice * 1.25);

    // Mapear ofertas
    const deals = rows
      .map(r => {
        const key = `${r.origin}|${r.destination}`;
        const hist = baseMap[key] || fallbackBase;
        const isEstimated = !baseMap[key];

        if (r.price >= hist) return null;
        const pct = Math.round(100 - (r.price / hist * 100));
        const tier = getDealTier(pct);
        if (!tier) return null;

        // O link de compra deve usar a data solicitada pelo usuário se houver, ou a data do voo
        const effectiveDate = reqDepartDate || r.depart_date;

        return {
          from:          cityName(r.origin),
          fromCode:      r.origin,
          to:            cityName(r.destination),
          toCode:        r.destination,
          date:          r.depart_date,
          dateFormatted: fmtDate(r.depart_date),
          daysDiff:      r.daysDiff,
          isExactDate:   r.isExactDate,
          price:         r.price,
          historicalAvg: hist,
          discountPct:   pct,
          isEstimated,
          tier,
          transfers:     r.transfers,
          airline:       r.airline,
          airlineName:   r.airlineName,
          link:          buildAviasalesLink(r.origin, r.destination, effectiveDate, reqReturnDate, marker),
          tag:           r.isNational ? "nacional" : "internacional",
          isNormalPrice: false,
        };
      })
      .filter(Boolean);

    if (reqDepartDate) {
      deals.sort((a, b) => a.daysDiff - b.daysDiff || b.discountPct - a.discountPct);
    } else {
      deals.sort((a, b) => b.discountPct - a.discountPct);
    }

    // Fallback regular
    const normalFallback = deals.length ? [] : rows
      .slice(0, 6)
      .map(r => {
        const effectiveDate = reqDepartDate || r.depart_date;
        return {
          from:          cityName(r.origin),
          fromCode:      r.origin,
          to:            cityName(r.destination),
          toCode:        r.destination,
          date:          r.depart_date,
          dateFormatted: fmtDate(r.depart_date),
          daysDiff:      r.daysDiff,
          isExactDate:   r.isExactDate,
          price:         r.price,
          historicalAvg: baseMap[`${r.origin}|${r.destination}`] || null,
          discountPct:   0,
          isNormalPrice: true,
          tier:          null,
          transfers:     r.transfers,
          airline:       r.airline,
          airlineName:   r.airlineName,
          link:          buildAviasalesLink(r.origin, r.destination, effectiveDate, reqReturnDate, marker),
          tag:           r.isNational ? "nacional" : "internacional",
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
        depart_date: reqDepartDate,
        one_way: isOneWay,
        updatedAt: new Date().toISOString(),
      },
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: "Erro interno ao processar ofertas." });
  }
}
