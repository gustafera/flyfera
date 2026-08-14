/* =============================================================================
   flyfera — app.js (Frontend Controller v9 - Identificação de Aeroportos)
   ============================================================================= */

// ── Mock data ──────────────────────────────────────────────────────────────
function buildMockLink(fromCode, toCode, date) {
  return `https://www.kiwi.com/br/search/results/${fromCode.toLowerCase()}/${toCode.toLowerCase()}/${date || 'anytime'}/no-return?currency=BRL`;
}

const MOCK_DEALS = [
  {
    from: "Brasília — Pres. JK (BSB)", fromCode: "BSB",
    to: "Campinas / SP — Viracopos (VCP)", toCode: "VCP",
    date: "2026-09-17", dateFormatted: "17 de set. de 2026",
    price: 219, historicalAvg: 580, discountPct: 62, isEstimated: false,
    airlineName: "Azul Linhas Aéreas", isExactDate: true,
    tier: { key: "hot", label: "Imperdível", emoji: "🔥" },
    tag: "nacional", transfers: 0,
    link: buildMockLink("BSB", "VCP", "2026-09-17")
  },
  {
    from: "São Paulo — Guarulhos (GRU)", fromCode: "GRU",
    to: "Brasília — Pres. JK (BSB)", toCode: "BSB",
    date: "2026-08-25", dateFormatted: "25 de ago. de 2026",
    price: 340, historicalAvg: 580, discountPct: 41, isEstimated: false,
    airlineName: "LATAM / GOL / Azul", isExactDate: true,
    tier: { key: "hot", label: "Imperdível", emoji: "🔥" },
    tag: "nacional", transfers: 0,
    link: buildMockLink("GRU", "BSB", "2026-08-25")
  },
  {
    from: "São Paulo — Guarulhos (GRU)", fromCode: "GRU",
    to: "Lisboa — Humberto Delgado (LIS)", toCode: "LIS",
    date: "2026-10-12", dateFormatted: "12 de out. de 2026",
    price: 2380, historicalAvg: 3690, discountPct: 35, isEstimated: false,
    airlineName: "TAP Air Portugal",
    tier: { key: "hot", label: "Imperdível", emoji: "🔥" },
    tag: "internacional", transfers: 0,
    link: buildMockLink("GRU", "LIS", "2026-10-12")
  }
];

// ── Estado Global ──────────────────────────────────────────────────────────
let allDeals = [];
let allNormal = [];
let filterType = "all";
let filterTier = "all";
let sortBy = "discount";
let updatedAt = null;
let refreshTimer = null;

// ── Formatadores e Utilitários ─────────────────────────────────────────────
function fmtBRL(value) {
  const num = Number(value);
  if (isNaN(num) || num <= 0) return "Consulte";
  return "R$ " + Math.round(num).toLocaleString("pt-BR");
}

function timeAgo(iso) {
  if (!iso) return "agora";
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  return `há ${Math.floor(diff / 3600)}h`;
}

function toAirport(code) {
  if (!code) return "GRU";
  const c = code.toUpperCase();
  if (c === "SAO") return "GRU";
  if (c === "RIO") return "GIG";
  if (c === "BHZ") return "CNF";
  return c;
}

// ── Skeletons ──────────────────────────────────────────────────────────────
function skeletonCard() {
  const d = document.createElement("div");
  d.className = "deal-card skeleton";
  d.innerHTML = `
    <div class="tier-badge skel"></div>
    <div class="deal-body">
      <div class="skel-line skel h20 w70"></div>
      <div class="skel-line skel w50"></div>
      <div class="skel-line skel w100" style="height:48px;margin-top:4px;border-radius:8px;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px dashed rgba(255,255,255,.05);">
        <div class="skel-line skel h28 w30" style="margin:0;"></div>
        <div class="skel-line skel w30" style="height:34px;border-radius:8px;margin:0;"></div>
      </div>
    </div>`;
  return d;
}

function skeletonRow() {
  const r = document.createElement("div");
  r.className = "board-row skeleton";
  r.innerHTML = `
    <div class="skel" style="width:8px;height:8px;border-radius:50%;"></div>
    <div class="skel-line skel w100" style="height:12px;margin:0;"></div>
    <div class="skel-line skel w70"  style="height:12px;margin:0;"></div>
    <div class="skel-line skel w50"  style="height:12px;margin:0;"></div>
    <div class="skel-line skel w100" style="height:12px;margin:0;"></div>
    <div class="skel-line skel w70"  style="height:12px;margin:0;"></div>`;
  return r;
}

function showSkeletons() {
  const grid = document.getElementById("deal-grid");
  const board = document.getElementById("board-panel");
  if (grid) {
    grid.innerHTML = "";
    for (let i = 0; i < 6; i++) grid.appendChild(skeletonCard());
  }
  if (board) {
    board.innerHTML = "";
    for (let i = 0; i < 7; i++) board.appendChild(skeletonRow());
  }
}

// ── API Fetch com Suporte a 'Só Ida' e Data ────────────────────────────────
async function fetchDeals(origin, destination, departDate, returnDate, isOneWay = true) {
  const qs = new URLSearchParams();
  if (origin) qs.set("origin", origin);
  if (destination && destination !== "ANY") qs.set("destination", destination);
  if (departDate) qs.set("depart_date", departDate);
  if (returnDate) qs.set("return_date", returnDate);
  qs.set("one_way", isOneWay ? "true" : "false");

  try {
    const res = await fetch(`/api/deals?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success) {
      updatedAt = json.meta?.updatedAt || new Date().toISOString();
      return {
        deals: json.data || [],
        normalFallback: json.normalFallback || []
      };
    }
    return { deals: mockFallback(origin, destination), normalFallback: [] };
  } catch (err) {
    console.warn("Falha na API, utilizando dados demonstrativos:", err);
    return { deals: mockFallback(origin, destination), normalFallback: [] };
  }
}

function mockFallback(origin, destination) {
  updatedAt = new Date().toISOString();
  let r = MOCK_DEALS;
  if (origin) {
    const fromMatches = r.filter(d => d.fromCode === origin);
    if (fromMatches.length) r = fromMatches;
  }
  if (destination && destination !== "ANY") {
    r = r.filter(d => d.toCode === destination);
  }
  return r;
}

// ── Geradores de Links Seguros ─────────────────────────────────────────────
function getKiwiUrl(from, to, date) {
  const f = toAirport(from).toLowerCase();
  const t = toAirport(to).toLowerCase();
  const d = date || "anytime";
  return `https://www.kiwi.com/br/search/results/${f}/${t}/${d}/no-return?currency=BRL`;
}

function getTripUrl(from, to, date) {
  const f = toAirport(from);
  const t = toAirport(to);
  const d = date || "";
  return `https://br.trip.com/flights/${f.toLowerCase()}-to-${t.toLowerCase()}/tickets-${f.toLowerCase()}-${t.toLowerCase()}?dcity=${f}&acity=${t}&ddate=${d}&locale=pt-BR&curr=BRL`;
}

function getSkyscannerUrl(from, to, date) {
  const f = toAirport(from).toLowerCase();
  const t = toAirport(to).toLowerCase();
  let dateSeg = "";
  if (date) {
    const p = date.split("-");
    dateSeg = `${p[0].slice(2)}${p[1]}${p[2]}`;
  }
  return `https://www.skyscanner.com.br/transporte/passagens-aereas/${f}/${t}/${dateSeg ? dateSeg + '/' : ''}`;
}

// ── Renderização dos Cards ─────────────────────────────────────────────────
function renderDeals(dealList, normalList = []) {
  const grid = document.getElementById("deal-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const searchedDate = document.getElementById("depart")?.value || "";

  function createCardElement(d) {
    const isNormal = Boolean(d.isNormalPrice);
    const tierKey = isNormal ? "normal" : (d.tier?.key || "below");
    const tierLabel = isNormal ? "📊 Preço no padrão" : `${d.tier?.emoji || "📉"} ${d.tier?.label || "Abaixo do normal"}`;
    const tierPct = isNormal ? "" : `<span class="pct">-${d.discountPct}%</span>`;
    const transferLabel = d.transfers === 0 ? "Direto"
      : d.transfers === 1 ? "1 escala" : `${d.transfers} escalas`;

    let dateBadge = `📅 ${d.dateFormatted || d.date || "Data flexível"}`;
    if (searchedDate && d.isExactDate) {
      dateBadge = `🎯 Data exata: ${d.dateFormatted || d.date}`;
    } else if (searchedDate && d.daysDiff > 0) {
      dateBadge = `📅 ${d.dateFormatted || d.date} (mais próxima)`;
    }

    const histSection = (d.historicalAvg && !isNormal)
      ? `<div class="deal-historical">
           <div>
             <div class="label">Média 3 meses</div>
             <div class="was">${fmtBRL(d.historicalAvg)}</div>
           </div>
           <div style="color:var(--ink-dim);font-size:.7rem;">vs. hoje</div>
         </div>`
      : (d.historicalAvg && isNormal)
      ? `<div class="deal-historical">
           <div>
             <div class="label">Média histórica</div>
             <div class="was" style="text-decoration:none;color:var(--ink-muted);">${fmtBRL(d.historicalAvg)}</div>
           </div>
           <div style="color:var(--ink-dim);font-size:.7rem;">preço normal</div>
         </div>`
      : "";

    const normalNotice = isNormal
      ? `<div class="normal-notice">Este voo está no valor padrão para esta rota. Não é uma promoção extraordinária, mas é uma das opções mais baratas disponíveis agora.</div>`
      : "";

    const airlineLabel = d.airlineName ? `<span>✈️ ${d.airlineName}</span><span class="dot">·</span>` : "";

    const card = document.createElement("div");
    card.className = `deal-card tier-${tierKey}`;
    card.innerHTML = `
      <div class="tier-badge ${tierKey}">${tierLabel}${tierPct}</div>
      <div class="deal-body">
        <div class="deal-route">
          ${d.from} → ${d.to}
          <span class="code">${d.fromCode} · ${d.toCode}</span>
        </div>
        <div class="deal-meta">
          <span>${dateBadge}</span>
          <span class="dot">·</span>
          ${airlineLabel}
          <span>${d.tag === "nacional" ? "Voo nacional" : "Voo internacional"}</span>
          <span class="dot">·</span>
          <span>${transferLabel}</span>
        </div>
        ${normalNotice}
        ${histSection}
        <div class="deal-bottom">
          <div class="deal-price">
            <div class="label">Preço hoje (em R$)</div>
            <div class="value">${fmtBRL(d.price)}</div>
          </div>
          <button class="deal-link" type="button">Comprar / Ver opções</button>
        </div>
      </div>`;

    card.querySelector(".deal-link").addEventListener("click", () => openModal(d));
    return card;
  }

  if (!dealList.length && !normalList.length) {
    const origin = document.getElementById("origin")?.value || "";
    const destination = document.getElementById("destination")?.value || "";
    const departDate = document.getElementById("depart")?.value || "";

    const kiwiLink = getKiwiUrl(origin, destination, departDate);
    const tripLink = getTripUrl(origin, destination, departDate);
    const skyLink  = getSkyscannerUrl(origin, destination, departDate);

    grid.innerHTML = `
      <div class="empty-state">
        <strong>Nenhum voo promocional registrado no cache para ${departDate ? departDate.split('-').reverse().join('/') : 'esta data'}</strong>
        Para a rota <b>${origin}${destination && destination !== "ANY" ? " → " + destination : ""}</b>, você pode consultar as passagens em tempo real diretamente em Reais (R$):
        <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:16px;">
          <a href="${kiwiLink}" target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;background:var(--signal-dim);color:var(--signal);border:1px solid rgba(0,230,168,.4);border-radius:10px;font-weight:700;font-size:.86rem;text-decoration:none;">
            🥝 Kiwi.com (R$)
          </a>
          <a href="${tripLink}" target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;background:rgba(38,128,235,.15);color:#2680eb;border:1px solid rgba(38,128,235,.4);border-radius:10px;font-weight:600;font-size:.86rem;text-decoration:none;">
            🌐 Trip.com (R$)
          </a>
          <a href="${skyLink}" target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;background:rgba(255,178,62,.15);color:var(--amber);border:1px solid rgba(255,178,62,.4);border-radius:10px;font-weight:600;font-size:.86rem;text-decoration:none;">
            ✈️ Comparar Cias (R$)
          </a>
        </div>
      </div>`;
    return;
  }

  dealList.forEach(d => grid.appendChild(createCardElement(d)));

  if (!dealList.length && normalList.length) {
    const origin = document.getElementById("origin")?.value || "";
    const destination = document.getElementById("destination")?.value || "";
    const banner = document.createElement("div");
    banner.className = "empty-state";
    banner.style.marginBottom = "16px";
    banner.innerHTML = `
      <strong>Nenhuma promoção fora do comum para esta data</strong>
      A rota <b>${origin}${destination && destination !== "ANY" ? " → " + destination : ""}</b> está com tarifas no padrão normal de mercado hoje.
      <br>Abaixo estão as <b>melhores opções disponíveis</b> encontradas:`;
    grid.insertBefore(banner, grid.firstChild);

    const sep = document.createElement("div");
    sep.className = "normal-section-header";
    sep.innerHTML = `<div class="line"></div><div class="label">Voos com preço padrão</div><div class="line"></div>`;
    grid.appendChild(sep);

    normalList.forEach(d => grid.appendChild(createCardElement(d)));
  }
}

// ── Animação Split-Flap ────────────────────────────────────────────────────
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function flapText(el, targetText) {
  if (reduceMotion) {
    el.textContent = targetText;
    return;
  }
  let step = 0;
  const totalSteps = 9;
  const timer = setInterval(() => {
    el.textContent = targetText.split("").map(char => {
      if (" →·,".includes(char)) return char;
      return step < totalSteps - 2 ? FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)] : char;
    }).join("");
    step++;
    if (step >= totalSteps) {
      clearInterval(timer);
      el.textContent = targetText;
    }
  }, 60);
}

function renderBoard(deals) {
  const panel = document.getElementById("board-panel");
  if (!panel) return;
  panel.innerHTML = "";

  const displayList = (deals && deals.length) ? deals.slice(0, 7) : MOCK_DEALS.slice(0, 7);

  displayList.forEach((d, idx) => {
    const isNormal = Boolean(d.isNormalPrice);
    const tierClass = isNormal ? "normal" : (d.tier?.key || "below");
    const badgeText = isNormal ? "Preço normal" : `-${d.discountPct}% vs. média`;

    const row = document.createElement("div");
    row.className = "board-row";
    row.innerHTML = `
      <span class="tier-dot ${tierClass}"></span>
      <span class="idx">${String(idx + 1).padStart(2, "0")}</span>
      <span class="route flap">${d.fromCode}<span class="via">→</span>${d.toCode}</span>
      <span class="date">${d.dateFormatted || d.date || "Flexível"}</span>
      <span class="price flap">${fmtBRL(d.price)}</span>
      <span class="badge" style="${isNormal ? 'background:rgba(255,255,255,.07);color:var(--ink-muted);border-color:rgba(255,255,255,.15);' : ''}">${badgeText}</span>`;
    panel.appendChild(row);

    const rEl = row.querySelector(".route");
    const pEl = row.querySelector(".price");
    setTimeout(() => flapText(rEl, `${d.fromCode} → ${d.toCode}`), idx * 80);
    setTimeout(() => flapText(pEl, fmtBRL(d.price)), idx * 80 + 50);
  });
}

// ── Filtros e Ordenação ────────────────────────────────────────────────────
function applyFilters() {
  let result = [...allDeals];
  if (filterType !== "all") {
    result = result.filter(d => d.tag === filterType);
  }
  if (filterTier !== "all") {
    result = result.filter(d => d.tier && d.tier.key === filterTier);
  }
  if (sortBy === "price") {
    result.sort((a, b) => (a.price || 0) - (b.price || 0));
  } else {
    result.sort((a, b) => (b.discountPct || 0) - (a.discountPct || 0));
  }
  renderDeals(result, allNormal);
}

function updateStats(deals) {
  const sb = document.getElementById("stats-bar");
  const cb = document.getElementById("control-bar");
  if (!sb || !cb) return;

  if (!deals.length) {
    sb.style.display = "none";
    cb.style.display = "none";
    return;
  }

  sb.style.display = "flex";
  cb.style.display = "flex";

  const discounts = deals.map(d => d.discountPct || 0);
  const best = discounts.length ? Math.max(...discounts) : 0;

  document.getElementById("stat-count").textContent =
    `${deals.length} oferta${deals.length > 1 ? "s" : ""} encontrada${deals.length > 1 ? "s" : ""}`;
  document.getElementById("stat-best").textContent = best > 0 ? `-${best}%` : "–";
  document.getElementById("stat-updated").textContent = `Atualizado ${timeAgo(updatedAt)}`;
}

// ── Modal de Detalhes da Oferta (Com Identificação Precisa do Aeroporto) ────
function openModal(deal) {
  const isNormal = Boolean(deal.isNormalPrice);
  const tierKey = isNormal ? "normal" : (deal.tier?.key || "below");
  const tierLabel = isNormal ? "📊 Preço no padrão" : `${deal.tier?.emoji || "📉"} ${deal.tier?.label || "Abaixo do normal"} · -${deal.discountPct}%`;
  const transferLabel = deal.transfers === 0 ? "Voo direto"
    : deal.transfers === 1 ? "1 escala" : `${deal.transfers} escalas`;
  const tagLabel = deal.tag === "nacional" ? "Nacional" : "Internacional";
  const searchedDate = document.getElementById("depart")?.value || deal.date || "";
  const isOneWay = document.querySelector(".trip-toggle button.active")?.dataset.trip === "one";

  const isSaoPaulo = deal.toCode === "SAO" || deal.toCode === "VCP" || deal.toCode === "GRU" || deal.toCode === "CGH";

  const kiwiUrl = getKiwiUrl(deal.fromCode, deal.toCode, searchedDate);
  const tripUrl = getTripUrl(deal.fromCode, deal.toCode, searchedDate);
  const skyscannerUrl = getSkyscannerUrl(deal.fromCode, deal.toCode, searchedDate);

  const modalBody = document.getElementById("modal-body");
  if (!modalBody) return;

  modalBody.innerHTML = `
    <div class="modal-tier-badge ${tierKey}">${tierLabel}</div>
    <div class="modal-route">${deal.from} → ${deal.to}</div>
    <div class="modal-codes">${deal.fromCode} &nbsp;·&nbsp; ${deal.toCode}</div>
    
    <div class="modal-grid">
      <div class="modal-cell">
        <div class="lbl">Data do voo</div>
        <div class="val">${deal.dateFormatted || deal.date || "Flexível"}</div>
      </div>
      <div class="modal-cell">
        <div class="lbl">Tipo de voo</div>
        <div class="val">${isOneWay ? "Só Ida" : "Ida e Volta"} · ${transferLabel}</div>
      </div>
      <div class="modal-cell">
        <div class="lbl">Preço base encontrado</div>
        <div class="val" style="color:var(--amber);font-weight:700;">${fmtBRL(deal.price)}</div>
      </div>
      <div class="modal-cell">
        <div class="lbl">Moeda de pagamento</div>
        <div class="val">🇧🇷 100% em Reais (R$)</div>
      </div>
    </div>

    ${isSaoPaulo ? `
      <div style="background:rgba(255,178,62,.08);border:1px solid rgba(255,178,62,.2);border-radius:10px;padding:10px 12px;font-size:.74rem;color:var(--ink-muted);line-height:1.45;margin-bottom:14px;">
        💡 <strong>Entenda os Aeroportos de São Paulo:</strong><br>
        Tarifas promocionais mais baratas (R$ 180 a R$ 300) costumam pousar em <b>Viracopos / Campinas (VCP)</b> operadas pela <b>Azul</b>. Voos para <b>Guarulhos (GRU)</b> ou <b>Congonhas (CGH)</b> pela <b>LATAM</b> e <b>GOL</b> possuem valores e disponibilidades diferentes.
      </div>
    ` : ''}

    <div class="sellers-section-title">
      Onde emitir esta passagem
      <span>Preços em Reais (R$)</span>
    </div>

    <div class="modal-sellers-list">
      
      <!-- 1. Kiwi.com Brasil -->
      <div class="seller-card best">
        <div class="seller-info">
          <div class="seller-icon kiwi">🥝</div>
          <div>
            <div class="seller-name">Kiwi.com</div>
            <div class="seller-sub">Menor tarifa encontrada · Pix e Cartão Nacional</div>
          </div>
        </div>
        <div class="seller-action">
          <div class="seller-price">${fmtBRL(deal.price)}</div>
          <a class="seller-btn" href="${kiwiUrl}" target="_blank" rel="noopener noreferrer">
            Comprar no Kiwi &rarr;
          </a>
        </div>
      </div>

      <!-- 2. Trip.com Brasil -->
      <div class="seller-card">
        <div class="seller-info">
          <div class="seller-icon trip">🌐</div>
          <div>
            <div class="seller-name">Trip.com</div>
            <div class="seller-sub">Emissão direta · Suporte 24h em Português</div>
          </div>
        </div>
        <div class="seller-action">
          <div class="seller-price">${fmtBRL(Math.round(deal.price * 1.02))}</div>
          <a class="seller-btn sec" href="${tripUrl}" target="_blank" rel="noopener noreferrer">
            Comprar no Trip.com &rarr;
          </a>
        </div>
      </div>

      <!-- 3. Skyscanner Brasil -->
      <div class="seller-card">
        <div class="seller-info">
          <div class="seller-icon" style="background:rgba(255,178,62,.15);color:var(--amber);">✈️</div>
          <div>
            <div class="seller-name">Comparar Todos os Aeroportos de SP</div>
            <div class="seller-sub">Compara Viracopos (VCP), Guarulhos (GRU) e Congonhas (CGH)</div>
          </div>
        </div>
        <div class="seller-action">
          <div class="seller-price">${fmtBRL(deal.price)}</div>
          <a class="seller-btn sec" href="${skyscannerUrl}" target="_blank" rel="noopener noreferrer">
            Ver Aeroportos &rarr;
          </a>
        </div>
      </div>

      <!-- 4. Portais Oficiais das Cias -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
        <a href="https://www.voeazul.com.br/" target="_blank" rel="noopener noreferrer"
           style="background:rgba(0,50,160,.18);border:1px solid rgba(0,50,160,.35);color:#528fff;padding:8px 6px;border-radius:8px;font-size:.76rem;font-weight:700;text-align:center;text-decoration:none;">
          Azul (VCP) ↗
        </a>
        <a href="https://www.latamairlines.com/br/pt/" target="_blank" rel="noopener noreferrer"
           style="background:rgba(230,0,38,.12);border:1px solid rgba(230,0,38,.3);color:#ff526a;padding:8px 6px;border-radius:8px;font-size:.76rem;font-weight:700;text-align:center;text-decoration:none;">
          LATAM (GRU/CGH) ↗
        </a>
        <a href="https://www.voegol.com.br/" target="_blank" rel="noopener noreferrer"
           style="background:rgba(255,102,0,.12);border:1px solid rgba(255,102,0,.3);color:#ff8c3b;padding:8px 6px;border-radius:8px;font-size:.76rem;font-weight:700;text-align:center;text-decoration:none;">
          GOL (CGH/GRU) ↗
        </a>
      </div>

    </div>

    <p style="text-align:center;font-size:.7rem;color:var(--ink-dim);line-height:1.4;margin-top:10px;">
      🔒 Cobrança 100% em Reais (R$) com suporte a cartões brasileiros e Pix.
    </p>`;

  const ov = document.getElementById("modal-overlay");
  if (ov) {
    ov.classList.add("open");
    ov.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
}

function closeModal() {
  const ov = document.getElementById("modal-overlay");
  if (ov) {
    ov.classList.remove("open");
    ov.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
}

// ── Auto-Refresh ───────────────────────────────────────────────────────────
function resetAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    const origin = document.getElementById("origin")?.value || "";
    const destination = document.getElementById("destination")?.value || "";
    const departDate = document.getElementById("depart")?.value || "";
    const returnDate = document.getElementById("return")?.value || "";
    const isOneWay = document.querySelector(".trip-toggle button.active")?.dataset.trip === "one";

    const { deals, normalFallback } = await fetchDeals(origin, destination, departDate, returnDate, isOneWay);
    allDeals = deals;
    allNormal = normalFallback;
    renderBoard(allDeals);
    applyFilters();
    updateStats(allDeals);
  }, 5 * 60 * 1000);
}

// ── Inicialização ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const todayIso = new Date().toISOString().split("T")[0];
  const departInput = document.getElementById("depart");
  const returnInput = document.getElementById("return");
  if (departInput) departInput.min = todayIso;
  if (returnInput) returnInput.min = todayIso;

  // Filtros
  const filterContainer = document.getElementById("filter-pills");
  if (filterContainer) {
    filterContainer.addEventListener("click", e => {
      const pill = e.target.closest(".filter-pill");
      if (!pill) return;
      const { group, val } = pill.dataset;

      document.querySelectorAll(`.filter-pill[data-group="${group}"]`).forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      if (group === "type") filterType = val;
      if (group === "tier") filterTier = (filterTier === val) ? "all" : val;
      applyFilters();
    });
  }

  // Ordenação
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", e => {
      sortBy = e.target.value;
      applyFilters();
    });
  }

  // Toggle Tipo de Viagem
  document.querySelectorAll(".trip-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".trip-toggle button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if (returnInput && returnInput.parentElement) {
        returnInput.parentElement.style.display = btn.dataset.trip === "one" ? "none" : "flex";
      }
    });
  });

  // Formulário de Busca
  const searchForm = document.getElementById("search-form");
  if (searchForm) {
    searchForm.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("btn-search");
      if (btn) {
        btn.classList.add("loading");
        btn.disabled = true;
        const label = btn.querySelector(".btn-label");
        if (label) label.textContent = "Buscando...";
      }

      showSkeletons();

      const origin = document.getElementById("origin")?.value || "";
      const destination = document.getElementById("destination")?.value || "";
      const departDate = document.getElementById("depart")?.value || "";
      const returnDate = document.getElementById("return")?.value || "";
      const isOneWay = document.querySelector(".trip-toggle button.active")?.dataset.trip === "one";

      const { deals, normalFallback } = await fetchDeals(origin, destination, departDate, returnDate, isOneWay);
      allDeals = deals;
      allNormal = normalFallback;

      renderBoard(allDeals);
      renderDeals(allDeals, allNormal);
      updateStats(allDeals);

      if (btn) {
        btn.classList.remove("loading");
        btn.disabled = false;
        const label = btn.querySelector(".btn-label");
        if (label) label.textContent = "Buscar passagens";
      }

      const gridEl = document.getElementById("deal-grid");
      if (gridEl) gridEl.scrollIntoView({ behavior: "smooth", block: "start" });

      resetAutoRefresh();
    });
  }

  // Alertas
  const alertForm = document.getElementById("alert-form");
  if (alertForm) {
    alertForm.addEventListener("submit", e => {
      e.preventDefault();
      const msg = document.getElementById("alert-msg");
      if (msg) msg.textContent = "E-mail cadastrado com sucesso! Avisaremos quando o serviço entrar no ar.";
    });
  }

  // Modal Close Handlers
  const modalCloseBtn = document.getElementById("modal-close");
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);

  const modalOverlay = document.getElementById("modal-overlay");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", e => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  // Carga Inicial
  (async function init() {
    showSkeletons();
    const { deals, normalFallback } = await fetchDeals();
    allDeals = deals;
    allNormal = normalFallback;
    renderBoard(allDeals);
    renderDeals(allDeals, allNormal);
    updateStats(allDeals);
    resetAutoRefresh();
  })();
});
