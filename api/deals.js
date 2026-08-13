// =============================================================================
// /api/deals.js — Vercel Serverless Function
// -----------------------------------------------------------------------------
// Essa função roda no SERVIDOR (nunca no navegador do visitante), então é o
// lugar seguro pra usar o token da Travelpayouts. O token nunca aparece no
// código do site nem no repositório — ele vem de uma variável de ambiente
// chamada TRAVELPAYOUTS_TOKEN, configurada direto no painel do Vercel.
//
// O front-end (index.html) chama esta função em /api/deals?origin=GRU&destination=LIS
// e recebe de volta uma lista já pronta no formato que os cards/painel esperam.
// =============================================================================

// Pequeno dicionário pra transformar código IATA em nome de cidade legível.
// Se o código não estiver aqui, mostramos o próprio código IATA.
const AIRPORT_NAMES = {
  GRU: "São Paulo", CGH: "São Paulo", GIG: "Rio de Janeiro", SDU: "Rio de Janeiro",
  BSB: "Brasília", CNF: "Belo Horizonte", POA: "Porto Alegre", CWB: "Curitiba",
  REC: "Recife", SSA: "Salvador", FOR: "Fortaleza", FLN: "Florianópolis",
  MCZ: "Maceió", BEL: "Belém", MAO: "Manaus", VCP: "Campinas",
  LIS: "Lisboa", OPO: "Porto", MIA: "Miami", MCO: "Orlando", JFK: "Nova York",
  EZE: "Buenos Aires", SCL: "Santiago", LIM: "Lima", BOG: "Bogotá",
  MAD: "Madri", CDG: "Paris", LHR: "Londres", FCO: "Roma",
};

// Aeroportos brasileiros conhecidos, usado só pra rotular "nacional" x "internacional".
const BR_AIRPORTS = new Set([
  "GRU","CGH","GIG","SDU","BSB","CNF","POA","CWB","REC","SSA","FOR","FLN","MCZ","BEL","MAO","VCP"
]);

function cityName(code) {
  return AIRPORT_NAMES[code] || code;
}

// ✅ CORREÇÃO: trocado "export default" por "module.exports" (CommonJS)
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

    // Usamos a média dos preços retornados como referência de "preço normal"
    // da rota, e marcamos como oferta tudo que está abaixo dessa média.
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
      .filter(d => d.price < d.avgPrice) // só o que está de fato abaixo da média
      .sort((a, b) => a.price - b.price);

    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Erro ao buscar preços." });
  }
}
