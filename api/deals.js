// =============================================================================
// /api/deals.js — Vercel Serverless Function
// =============================================================================

const AIRPORT_NAMES = {
  // Brasil
  GRU: "São Paulo", CGH: "São Paulo", VCP: "Campinas",
  GIG: "Rio de Janeiro", SDU: "Rio de Janeiro",
  BSB: "Brasília",
  CNF: "Belo Horizonte", PLU: "Belo Horizonte",
  POA: "Porto Alegre",
  CWB: "Curitiba",
  REC: "Recife",
  SSA: "Salvador",
  FOR: "Fortaleza",
  FLN: "Florianópolis",
  MCZ: "Maceió",
  BEL: "Belém",
  MAO: "Manaus",
  NAT: "Natal",
  SLZ: "São Luís",
  THE: "Teresina",
  AJU: "Aracaju",
  JPA: "João Pessoa",
  PMW: "Palmas",
  CGB: "Cuiabá",
  CGR: "Campo Grande",
  PVH: "Porto Velho",
  BVB: "Boa Vista",
  MCP: "Macapá",
  RBR: "Rio Branco",
  IGU: "Foz do Iguaçu",
  JOI: "Joinville",
  NVT: "Navegantes",
  LDB: "Londrina",
  MGF: "Maringá",
  UDI: "Uberlândia",
  VIX: "Vitória",
  IOS: "Ilhéus",
  PPB: "Presidente Prudente",
  RAO: "Ribeirão Preto",
  // Portugal
  LIS: "Lisboa", OPO: "Porto",
  // EUA
  MIA: "Miami", MCO: "Orlando", JFK: "Nova York",
  EWR: "Nova York", LAX: "Los Angeles", ORD: "Chicago",
  // América do Sul
  EZE: "Buenos Aires", AEP: "Buenos Aires",
  SCL: "Santiago", LIM: "Lima", BOG: "Bogotá",
  UIO: "Quito", GYE: "Guayaquil", MVD: "Montevidéu",
  ASU: "Assunção", CCS: "Caracas",
  // Europa
  MAD: "Madri", BCN: "Barcelona",
  CDG: "Paris", ORY: "Paris",
  LHR: "Londres", LGW: "Londres",
  FCO: "Roma", MXP: "Milão",
  AMS: "Amsterdã", FRA: "Frankfurt",
  // Outros
  DXB: "Dubai", CUN: "Cancún",
  NRT: "Tóquio", GRU: "São Paulo",
};

const BR_AIRPORTS = new Set([
  "GRU","CGH","VCP","GIG","SDU","BSB","CNF","PLU","POA","CWB",
  "REC","SSA","FOR","FLN","MCZ","BEL","MAO","NAT","SLZ","THE",
  "AJU","JPA","PMW","CGB","CGR","PVH","BVB","MCP","RBR","IGU",
  "JOI","NVT","LDB","MGF","UDI","VIX","IOS","PPB","RAO"
]);

function cityName(code) {
  return AIRPORT_NAMES[code] || code;
}

// ✅ CommonJS — compatível com Vercel sem package.json extra
module.exports = async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;

  if (!token) {
    res.status(500).json({ success: false, error: "TRAVELPAYOUTS_TOKEN não configurado no servidor." });
    return;
  }

  const origin = (req.query.origin || "GRU").toUpperCase();
  const destination = req.query.destination && req.query.destination !== "ANY"
    ? req.query.destination.toUpperCase()
    : null;

  try {
    const params = new URLSearchParams({
      currency: "brl",
      origin,
      sorting: "price",
      limit: "50",
      page: "1",
      one_way: "false",
    });
    if (destination) params.set("destination", destination);

    const apiUrl = `https://api.travelpayouts.com/v2/prices/latest?${params.toString()}`;

    const apiRes = await fetch(apiUrl, {
      headers: { "X-Access-Token": token },
    });

    if (!apiRes.ok) {
      res.status(apiRes.status).json({ success: false, error: `Travelpayouts respondeu ${apiRes.status}` });
      return;
    }

    const json = await apiRes.json();
    const rows = Array.isArray(json.data) ? json.data : [];

    if (!rows.length) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const avg = rows.reduce((sum, r) => sum + r.price, 0) / rows.length;

    const data = rows
      .map(r => ({
        from: cityName(r.origin),
        fromCode: r.origin,
        to: cityName(r.destination),
        toCode: r.destination,
        date: r.depart_date || "",
        price: r.price,
        avgPrice: Math.round(avg),
        tag: BR_AIRPORTS.has(r.origin) && BR_AIRPORTS.has(r.destination) ? "nacional" : "internacional",
      }))
      .filter(d => d.price < d.avgPrice)
      .sort((a, b) => a.price - b.price);

    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Erro ao buscar preços." });
  }
}
