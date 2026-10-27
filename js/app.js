(function () {
  "use strict";

  const C = window.CONTENT;
  const CFG = window.CONFIG || {};
  // Add ?test to the address to try the page without touching the shared list.
  const TEST_MODE = /[?&]test\b/.test(location.search);
  const ONLINE = !TEST_MODE && !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const LS_LANG = "lista.lang";
  const LS_TOKENS = "lista.tokens";       // { id: undoToken } for claims and contributions made on this device
  const LS_LOCAL = "lista.localClaims";   // test mode only
  const LS_LOCAL_FUND = "lista.localFund"; // test mode only
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FUND_ID = "__fund";
  const ROOM_ICON = { cozinha: "🍳", sala: "🛋️", quartos: "🛏️", banheiro: "🚿", externa: "🧺" };
  const FILTERS = ["all", "cozinha", "sala", "quartos", "banheiro", "externa", "budget"];
  const FILTER_ICON = { all: "🏠", cozinha: "🍳", sala: "🛋️", quartos: "🛏️", banheiro: "🚿", externa: "🧺", budget: "💸" };
  const BUDGET_MAX = 150;
  const QUICK = { BRL: [50, 100, 200, 500], USD: [20, 50, 100, 200] };

  // ---------- storage ----------
  function readJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function readStr(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeStr(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  let myTokens = readJSON(LS_TOKENS, {});

  // ---------- language ----------
  function pickLang() {
    const h = (location.hash || "").replace("#", "").toLowerCase();
    if (h === "en" || h === "pt") return h;
    const s = readStr(LS_LANG);
    if (s === "en" || s === "pt") return s;
    const nav = (navigator.language || "pt").toLowerCase();
    return nav.startsWith("en") ? "en" : "pt";
  }
  let lang = pickLang();
  const T = () => C.ui[lang];

  function setLang(next) {
    lang = next;
    writeStr(LS_LANG, lang);
    // Keep the shared link clean: drop any #pt / #en once someone picks a language.
    if (location.hash) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    render();
    if (sheet) renderSheet();
  }

  // ---------- backend ----------
  async function sb(path, options) {
    const res = await fetch(CFG.SUPABASE_URL + path, Object.assign({
      headers: {
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + CFG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
    }, options || {}));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      const err = new Error((body && body.message) || res.statusText);
      err.code = body && body.code;
      throw err;
    }
    return body;
  }
  const firstRow = (rows) => Array.isArray(rows) ? rows[0] : rows;

  const backend = ONLINE ? {
    async list() {
      const [claims, fund] = await Promise.all([
        sb("/rest/v1/claims?select=id,gift_id,giver_name,message,side,created_at&order=created_at.asc"),
        sb("/rest/v1/contributions?select=id,giver_name,amount,currency,message,side,created_at&order=created_at.asc"),
      ]);
      return { claims: claims || [], fund: fund || [] };
    },
    async claim(giftId, name, message, side) {
      const row = firstRow(await sb("/rest/v1/rpc/claim_gift", {
        method: "POST",
        body: JSON.stringify({ p_gift_id: giftId, p_name: name, p_message: message || null, p_side: side || null }),
      }));
      return { id: row.claim_id, token: row.undo_token };
    },
    async unclaim(id, token) {
      return sb("/rest/v1/rpc/unclaim_gift", { method: "POST", body: JSON.stringify({ p_claim_id: id, p_token: token }) });
    },
    async contribute(name, amount, currency, message, side) {
      const row = firstRow(await sb("/rest/v1/rpc/contribute", {
        method: "POST",
        body: JSON.stringify({ p_name: name, p_amount: amount, p_currency: currency, p_message: message || null, p_side: side || null }),
      }));
      return { id: row.contribution_id, token: row.undo_token };
    },
    async uncontribute(id, token) {
      return sb("/rest/v1/rpc/uncontribute", { method: "POST", body: JSON.stringify({ p_id: id, p_token: token }) });
    },
  } : {
    async list() { return { claims: readJSON(LS_LOCAL, []), fund: readJSON(LS_LOCAL_FUND, []) }; },
    async claim(giftId, name, message, side) {
      const all = readJSON(LS_LOCAL, []);
      const gift = C.gifts.find(g => g.id === giftId);
      const taken = all.filter(c => c.gift_id === giftId).length;
      if (!gift || taken >= gift.qty) { const e = new Error("taken"); e.code = "P0003"; throw e; }
      const id = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      all.push({ id, gift_id: giftId, giver_name: name, message: message || null, side: side || null, created_at: new Date().toISOString() });
      writeJSON(LS_LOCAL, all);
      return { id, token: "local" };
    },
    async unclaim(id) { writeJSON(LS_LOCAL, readJSON(LS_LOCAL, []).filter(c => c.id !== id)); return true; },
    async contribute(name, amount, currency, message, side) {
      const all = readJSON(LS_LOCAL_FUND, []);
      const id = "localf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      all.push({ id, giver_name: name, amount, currency, message: message || null, side: side || null, created_at: new Date().toISOString() });
      writeJSON(LS_LOCAL_FUND, all);
      return { id, token: "local" };
    },
    async uncontribute(id) { writeJSON(LS_LOCAL_FUND, readJSON(LS_LOCAL_FUND, []).filter(c => c.id !== id)); return true; },
  };

  // ---------- state ----------
  const GIFT_BY_ID = new Map(C.gifts.map(g => [g.id, g]));
  let claims = [];
  let fund = [];
  let dataKey = "";
  let openForm = null;   // gift id (or FUND_ID) whose form is open
  let formError = "";
  let busy = false;
  let filter = "all";
  let animateNext = true; // play entrance animations on first paint and filter changes only
  let usdRate = C.usd_rate || 5; // reais per US dollar; replaced by today's rate when it loads
  let fundCurrency = lang === "en" ? "USD" : "BRL";
  let sheet = null;      // { name, brl, amount, currency } while the "now send the money" pop-up is open
  let loadedOnce = false;  // has the shared list loaded at least once?
  let loadFailed = false;

  async function refresh() {
    try {
      const data = await backend.list();
      const list = (data.claims || []).filter(c => GIFT_BY_ID.has(c.gift_id));
      const f = (data.fund || []).map(x => Object.assign({}, x, { amount: Number(x.amount) }));
      const wasFailed = loadFailed;
      loadedOnce = true;
      loadFailed = false;
      const key = JSON.stringify([list.map(c => [c.id, c.side]), f.map(c => [c.id, c.side])]);
      if (key === dataKey && !wasFailed) return; // nothing changed, don't disturb anyone typing
      claims = list;
      fund = f;
      dataKey = key;
      render();
    } catch (e) {
      // Keep the last good list. If it never loaded, say so: otherwise every gift looks free.
      if (!loadedOnce && !loadFailed) { loadFailed = true; render(); }
    }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(n, cur) {
    const loc = lang === "pt" ? "pt-BR" : "en-US";
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    const s = Number(n).toLocaleString(loc, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    const sym = cur === "USD" ? "US$" : "R$";
    return lang === "pt" ? `${sym} ${s}` : `${sym}${s}`;
  }
  const brl = (n) => money(n, "BRL");
  const usd = (n) => money(Math.round(n / usdRate), "USD");
  const toBRL = (c) => c.currency === "USD" ? c.amount * usdRate : c.amount;
  function rateText() {
    return usdRate.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Reads "100", "1.500", "1,500", "1.500,50", "50,5" or "50.50" the way people type them.
  function parseAmount(str) {
    let s = String(str || "").replace(/[^\d.,]/g, "");
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "") : s.replace(/,/g, "");
    } else if (lastDot >= 0 && /\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, ""); // "1.500" means fifteen hundred
    }
    const n = Math.round(parseFloat(s) * 100) / 100;
    return n > 0 && n <= 100000 ? n : NaN;
  }
  function claimsFor(giftId) { return claims.filter(c => c.gift_id === giftId); }
  function leftOf(g) { return g.qty - claimsFor(g.id).length; }
  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  // Time left until Christmas in Brazil (midnight 25 Dec, Brasília time, UTC-3).
  // null on Christmas Day itself.
  function timeToChristmas() {
    const now = Date.now();
    let year = new Date(now).getUTCFullYear();
    let xmas = Date.UTC(year, 11, 25, 3);
    if (now >= xmas + 86400000) xmas = Date.UTC(++year, 11, 25, 3);
    if (now >= xmas) return null;
    const secs = Math.floor((xmas - now) / 1000);
    return { d: Math.floor(secs / 86400), h: Math.floor(secs / 3600) % 24, m: Math.floor(secs / 60) % 60, s: secs % 60 };
  }
  function renderCountdown() {
    const cd = document.getElementById("countdown");
    cd.textContent = T().countdown(timeToChristmas());
    cd.hidden = false;
  }
  function matchesFilter(g) {
    if (filter === "all") return true;
    if (filter === "budget") return g.price <= BUDGET_MAX;
    return g.room === filter;
  }
  // Gifts and contributions together, oldest first.
  function allGiving() {
    return claims.map(c => Object.assign({ kind: "gift" }, c))
      .concat(fund.map(f => Object.assign({ kind: "fund" }, f)))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.hidden = true;
    void el.offsetWidth; // restart the slide-in
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  // ---------- confetti ----------
  function confetti() {
    if (REDUCED) return;
    const canvas = document.getElementById("confetti");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#0f7a52", "#ffcc29", "#1d5fd1", "#ff5d8f", "#ffffff", "#1fb877"];
    const parts = [];
    const bursts = [[W * 0.2, H * 0.35], [W * 0.5, H * 0.25], [W * 0.8, H * 0.35]];
    for (const [bx, by] of bursts) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 4 + Math.random() * 9;
        parts.push({
          x: bx, y: by,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6,
          w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
          r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
          c: colors[(Math.random() * colors.length) | 0],
          round: Math.random() < .3,
        });
      }
    }
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 2600);
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 2 + 1, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < 2700) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ---------- render: header, steps, money box ----------
  function renderStatic() {
    const t = T();
    document.querySelectorAll("[data-t]").forEach(el => {
      const v = t[el.getAttribute("data-t")];
      if (typeof v === "string") el.textContent = v;
    });
    document.getElementById("couple").textContent = C.couple;
    document.getElementById("intro").innerHTML = t.intro.map(p => `<p>${esc(p)}</p>`).join("");
    document.getElementById("steps").innerHTML = t.how_steps.map((s, i) =>
      `<li><span class="step-icon" aria-hidden="true">${(t.step_icons || [])[i] || "✨"}</span><span>${esc(s)}</span><span class="step-num" aria-hidden="true">${i + 1}</span></li>`
    ).join("");
    document.querySelectorAll(".lang-opt").forEach(b => {
      const on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderCountdown();
    const le = document.getElementById("load-error");
    le.hidden = !loadFailed;
    le.textContent = t.load_error;
    const off = document.getElementById("offline");
    off.hidden = ONLINE;
    off.textContent = t.offline;
    document.getElementById("rate-note").textContent = t.rate_note(rateText());
    document.title = (lang === "pt" ? "Lista de presentes" : "Gift list") + " · " + C.couple;
  }

  // Payment options as HTML. `prefix` keeps element ids unique (page box vs pop-up).
  function payCardsHTML(prefix, usFirst) {
    const t = T();
    const P = C.payment || {};
    const cards = [];
    if (P.pix) {
      const isPhone = !/@/.test(P.pix) && /^\d{10,13}$/.test(String(P.pix).replace(/\D/g, ""));
      cards.push(`
        <div class="pay-card pay-pix">
          <p class="pay-kind">🇧🇷 ${esc(t.pay_pix)}</p>
          <p class="pay-label">${esc(t.pay_pix_name)}${isPhone ? ` (${esc(t.pay_pix_phone)})` : ""}${P.pix_holder ? ` · <span translate="no">${esc(P.pix_holder)}</span>` : ""}</p>
          <div class="pay-row"><code class="pay-value" id="${prefix}-pix" translate="no" data-value="${esc(P.pix)}">${esc(P.pix_display || P.pix)}</code>
          <button type="button" class="btn btn-primary pay-copy" data-copy="${prefix}-pix">${esc(t.pay_copy)}</button></div>
        </div>`);
    }
    const us = [];
    if (P.zelle) us.push(`<div class="pay-row"><span class="pay-tag">Zelle</span><code class="pay-value" id="${prefix}-zelle" translate="no">${esc(P.zelle)}</code>
      <button type="button" class="btn btn-primary pay-copy" data-copy="${prefix}-zelle">${esc(t.pay_copy)}</button></div>`);
    if (P.venmo) {
      const handle = String(P.venmo).replace(/^@/, "");
      us.push(`<div class="pay-row"><span class="pay-tag">Venmo</span><code class="pay-value" id="${prefix}-venmo" translate="no">@${esc(handle)}</code>
        <a class="btn btn-primary pay-copy" href="https://venmo.com/u/${encodeURIComponent(handle)}" target="_blank" rel="noopener">${esc(t.pay_open_venmo)}</a></div>`);
    }
    if (us.length) {
      cards.push(`
        <div class="pay-card pay-us">
          <p class="pay-kind">🇺🇸 ${esc(t.pay_us)}</p>
          <p class="pay-label">${esc(t.pay_us_name)}</p>
          ${us.join("")}
        </div>`);
    }
    if (usFirst && cards.length === 2) cards.reverse();
    return cards.join("");
  }

  function renderPay() {
    const html = payCardsHTML("pay", lang === "en");
    document.getElementById("paybox").hidden = html === "";
    document.getElementById("pay-grid").innerHTML = html;
  }

  // ---------- render: scoreboard ----------
  function renderScore() {
    const t = T();
    const total = C.gifts.reduce((a, g) => a + g.price * g.qty, 0);
    const giftValue = claims.reduce((a, c) => a + ((GIFT_BY_ID.get(c.gift_id) || {}).price || 0), 0);
    const fundValue = fund.reduce((a, f) => a + toBRL(f), 0);
    const raised = Math.round(giftValue + fundValue);
    const pct = total ? Math.min(100, Math.round((raised / total) * 100)) : 0;
    document.getElementById("done-num").textContent = pct + "%";
    document.getElementById("progress-label").textContent = t.progress_label(brl(raised), brl(total));
    document.getElementById("bar-fill").style.width = pct + "%";
    const bar = document.getElementById("bar");
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-label", `${pct}%`);
    document.getElementById("progress-sub").textContent = raised >= total ? t.progress_done : t.progress_sub;

  }

  function renderFilters(available) {
    const t = T();
    document.getElementById("filters").innerHTML = FILTERS.map(f => {
      const n = available.filter(g => f === "all" ? true : f === "budget" ? g.price <= BUDGET_MAX : g.room === f).length;
      const on = f === filter;
      return `<button type="button" class="chip${on ? " is-on" : ""}" data-filter="${f}" aria-pressed="${on}">${FILTER_ICON[f]} ${esc(t.filters[f])} <span class="n">${n}</span></button>`;
    }).join("");
  }

  // ---------- render: cards ----------
  function formButtonsHTML() {
    const t = T();
    return `
      ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
      <div class="row">
        <button type="button" class="btn btn-ghost" data-cancel>${esc(t.cancel)}</button>
        <button type="submit" class="btn btn-primary" ${busy ? "disabled" : ""}>${busy ? esc(t.saving) : "🎉 " + esc(t.confirm)}</button>
      </div>`;
  }

  function fundCardHTML(i, anim) {
    const t = T();
    let action;
    if (openForm === FUND_ID) {
      const sym = fundCurrency === "USD" ? "US$" : "R$";
      action = `
        <form class="claim-form" data-fund="1">
          <label class="f">${esc(t.name_label)}
            <input type="text" name="name" id="name-${FUND_ID}" maxlength="60" required autocomplete="name" placeholder="${esc(t.name_placeholder)}">
          </label>
          <div class="f">
            <span class="f-label" id="amt-label">${esc(t.fund_amount)}</span>
            <div class="amount-row">
              <div class="cur-switch" role="group" aria-label="${esc(t.fund_amount)}">
                <button type="button" class="cur-opt${fundCurrency === "BRL" ? " is-on" : ""}" data-cur="BRL" aria-pressed="${fundCurrency === "BRL"}">R$</button>
                <button type="button" class="cur-opt${fundCurrency === "USD" ? " is-on" : ""}" data-cur="USD" aria-pressed="${fundCurrency === "USD"}">US$</button>
              </div>
              <input type="text" name="amount" id="amt-${FUND_ID}" inputmode="decimal" autocomplete="off" aria-labelledby="amt-label" placeholder="${esc(t.fund_amount_ph)}">
            </div>
            <div class="quick">${QUICK[fundCurrency].map(v => `<button type="button" class="quick-chip" data-quick="${v}">${sym} ${v}</button>`).join("")}</div>
          </div>
          <label class="f">${esc(t.message_label)}
            <textarea name="message" id="msg-${FUND_ID}" maxlength="300" placeholder="${esc(t.message_placeholder)}"></textarea>
          </label>
          ${formButtonsHTML()}
        </form>`;
    } else {
      action = `<button type="button" class="btn btn-primary btn-fund" data-claim="${FUND_ID}">💛 ${esc(t.fund_btn)}</button>`;
    }
    return `
      <article class="card fund-card${anim ? " anim" : ""}" id="gift-${FUND_ID}" style="--i:${i}">
        <div class="card-img fund-img" aria-hidden="true">
          <span class="fund-emoji">🏡</span>
          <span class="fund-hearts"><span>💛</span><span>💚</span><span>💙</span></span>
          <span class="room-tag">💛 ${esc(t.fund_tag)}</span>
          <span class="sticker"><b>${esc(t.fund_any)}</b><small>R$ · US$</small></span>
        </div>
        <div class="card-body">
          <h3>${esc(t.fund_title)}</h3>
          <p class="why">${esc(t.fund_why)}</p>
          ${action}
        </div>
      </article>`;
  }

  function cardHTML(g, i, anim) {
    const t = T();
    const taken = claimsFor(g.id);
    const left = g.qty - taken.length;
    const name = g.name[lang];
    let partial = "";
    if (g.qty > 1) {
      const names = taken.map(c => `<b translate="no">${esc(c.giver_name)}</b>`).join(", ");
      partial = `<span class="pill">${esc(t.remaining(left))}</span>` +
        (taken.length ? `<p class="partial">${esc(t.gave_by)} ${names}</p>` : "");
    }
    let action;
    if (openForm === g.id) {
      action = `
        <form class="claim-form" data-gift="${esc(g.id)}">
          <label class="f">${esc(t.name_label)}
            <input type="text" name="name" id="name-${esc(g.id)}" maxlength="60" required autocomplete="name" placeholder="${esc(t.name_placeholder)}">
          </label>
          <label class="f">${esc(t.message_label)}
            <textarea name="message" id="msg-${esc(g.id)}" maxlength="300" placeholder="${esc(t.message_placeholder)}"></textarea>
          </label>
          ${formButtonsHTML()}
        </form>`;
    } else {
      action = `<button type="button" class="btn btn-primary" data-claim="${esc(g.id)}">🎁 ${esc(t.claim)}</button>`;
    }
    return `
      <article class="card${anim ? " anim" : ""}" id="gift-${esc(g.id)}" style="--i:${i}">
        <div class="card-img">
          <img src="${esc(g.image)}" alt="${esc(name)}" loading="lazy">
          <span class="room-tag">${ROOM_ICON[g.room] || ""} ${esc(t.filters[g.room] || "")}</span>
          ${g.qty > 1 ? `<span class="qty-tag">×${left}</span>` : ""}
          <span class="sticker"><b>${brl(g.price)}</b><small>≈ ${usd(g.price)}</small></span>
        </div>
        <div class="card-body">
          <h3>${esc(name)}</h3>
          <p class="why">${esc(g.why[lang])}</p>
          <a class="store-link" href="${esc(g.url)}" target="_blank" rel="noopener">${esc(t.store)} ↗ <span class="store-name">${esc(g.store)}</span></a>
          ${partial}
          ${action}
        </div>
      </article>`;
  }

  // ---------- render: wall ----------
  function muralHTML() {
    const t = T();
    return allGiving().reverse().map(c => {
      const isFund = c.kind === "fund";
      const g = isFund ? null : GIFT_BY_ID.get(c.gift_id);
      if (!isFund && !g) return "";
      const mine = myTokens[c.id];
      const tilt = ((hash(c.id) % 9) - 4) * 0.8;
      const pic = isFund
        ? `<div class="m-fund" aria-hidden="true">🏡<span>💛</span></div>`
        : `<img src="${esc(g.image)}" alt="">`;
      const what = isFund ? t.fund_mural : g.name[lang];
      const undoAttr = isFund ? "data-undo-fund" : "data-undo";
      return `
        <li style="--tilt:${tilt.toFixed(1)}deg">
          ${pic}
          <p class="m-by"><span translate="no">${esc(c.giver_name)}</span> <span class="heart">♥</span></p>
          <p class="m-gift">${esc(what)}</p>
          ${c.message ? `<p class="m-msg">“${esc(c.message)}”</p>` : ""}
          ${mine ? `<p class="m-undo"><button type="button" class="btn-link" ${undoAttr}="${esc(c.id)}">${esc(t.undo)}</button></p>` : ""}
        </li>`;
    }).join("");
  }

  // ---------- render: "now send the money" pop-up ----------
  function renderSheet() {
    const el = document.getElementById("sheet");
    if (!sheet) { el.hidden = true; document.body.classList.remove("sheet-open"); return; }
    const t = T();
    const amt = sheet.currency === "USD"
      ? `${money(sheet.amount, "USD")} <small>(≈ ${brl(Math.round(sheet.brl))})</small>`
      : `${brl(sheet.brl)} <small>(≈ ${usd(sheet.brl)})</small>`;
    document.getElementById("sheet-title").textContent = t.sheet_title(sheet.name);
    document.getElementById("sheet-send").textContent = t.sheet_send;
    document.getElementById("sheet-amount").innerHTML = amt;
    document.getElementById("sheet-pay").innerHTML = payCardsHTML("sheet", sheet.currency === "USD" || lang === "en");
    document.getElementById("sheet-note").textContent = t.sheet_note;
    document.getElementById("sheet-close").textContent = t.sheet_close;
    document.querySelector(".sheet-x").setAttribute("aria-label", t.sheet_close);
    el.hidden = false;
    document.body.classList.add("sheet-open");
  }
  function openSheet(data) {
    sheet = data;
    renderSheet();
    const box = document.querySelector(".sheet");
    if (box) { box.scrollTop = 0; box.focus({ preventScroll: true }); }
  }
  function closeSheet() {
    sheet = null;
    renderSheet();
    document.getElementById("given-section")?.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
  }

  // ---------- keep typed text when the page re-renders ----------
  function captureForm() {
    const form = document.querySelector(".claim-form");
    if (!form) return null;
    return {
      key: form.getAttribute("data-gift") || FUND_ID,
      name: form.elements.name.value,
      message: form.elements.message.value,
      amount: form.elements.amount ? form.elements.amount.value : "",
      focus: document.activeElement && form.contains(document.activeElement) ? document.activeElement.name : null,
    };
  }
  function restoreForm(saved) {
    if (!saved) return;
    const form = saved.key === FUND_ID
      ? document.querySelector(".claim-form[data-fund]")
      : document.querySelector(`.claim-form[data-gift="${CSS.escape(saved.key)}"]`);
    if (!form) return;
    form.elements.name.value = saved.name;
    form.elements.message.value = saved.message;
    if (form.elements.amount) form.elements.amount.value = saved.amount;
    if (saved.focus && form.elements[saved.focus] && form.elements[saved.focus].focus) form.elements[saved.focus].focus({ preventScroll: true });
  }

  function render() {
    const saved = captureForm();
    const anim = animateNext && !REDUCED;
    animateNext = false;

    renderStatic();
    renderPay();
    renderScore();

    const available = C.gifts.filter(g => leftOf(g) > 0);
    renderFilters(available);
    const shown = available.filter(matchesFilter);
    const showFund = filter === "all" || filter === "budget";
    const cards = (showFund ? [fundCardHTML(0, anim)] : [])
      .concat(shown.map((g, i) => cardHTML(g, i + (showFund ? 1 : 0), anim)));
    document.getElementById("available").innerHTML = cards.join("");
    document.getElementById("available-count").textContent = available.length ? `(${available.length})` : "";
    document.getElementById("none-left").hidden = available.length > 0;
    document.getElementById("filter-empty").hidden = !(available.length > 0 && shown.length === 0 && !showFund);

    document.getElementById("given-section").hidden = claims.length + fund.length === 0;
    document.getElementById("given").innerHTML = muralHTML();

    restoreForm(saved);
    if (openForm && !saved) {
      const input = document.getElementById("name-" + openForm);
      if (input) input.focus({ preventScroll: true });
    }
  }

  // ---------- events ----------
  async function undo(id, isFund) {
    const token = myTokens[id];
    try {
      if (isFund) await backend.uncontribute(id, token);
      else await backend.unclaim(id, token);
      delete myTokens[id];
      writeJSON(LS_TOKENS, myTokens);
      toast(isFund ? T().undo_fund_done : T().undo_done);
    } catch (e) {
      toast(T().error_generic);
    }
    dataKey = "";
    await refresh();
  }

  document.addEventListener("click", async (ev) => {
    if (ev.target.closest("[data-close-sheet]") || ev.target.id === "sheet") { closeSheet(); return; }

    const copyBtn = ev.target.closest("[data-copy]");
    if (copyBtn) {
      const el = document.getElementById(copyBtn.getAttribute("data-copy"));
      const text = el ? (el.getAttribute("data-value") || el.textContent).trim() : "";
      const done = () => { const old = copyBtn.textContent; copyBtn.textContent = T().pay_copied; setTimeout(() => { copyBtn.textContent = old; }, 1800); };
      const select = () => { try { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {} };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, select);
      else select();
      return;
    }

    const claimBtn = ev.target.closest("[data-claim]");
    if (claimBtn) {
      openForm = claimBtn.getAttribute("data-claim");
      formError = "";
      render();
      document.getElementById("gift-" + openForm)?.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
      return;
    }
    if (ev.target.closest("[data-cancel]")) { openForm = null; formError = ""; render(); return; }

    const cur = ev.target.closest("[data-cur]");
    if (cur) {
      const next = cur.getAttribute("data-cur");
      if (next !== fundCurrency) { fundCurrency = next; render(); }
      return;
    }
    const quick = ev.target.closest("[data-quick]");
    if (quick) {
      const input = document.getElementById("amt-" + FUND_ID);
      if (input) { input.value = quick.getAttribute("data-quick"); input.focus({ preventScroll: true }); }
      return;
    }

    const chip = ev.target.closest("[data-filter]");
    if (chip) {
      const f = chip.getAttribute("data-filter");
      if (f !== filter) { filter = f; animateNext = true; render(); }
      return;
    }
    const undoBtn = ev.target.closest("[data-undo]");
    if (undoBtn) { undoBtn.disabled = true; await undo(undoBtn.getAttribute("data-undo"), false); return; }
    const undoFund = ev.target.closest("[data-undo-fund]");
    if (undoFund) { undoFund.disabled = true; await undo(undoFund.getAttribute("data-undo-fund"), true); return; }

    const langBtn = ev.target.closest("[data-lang]");
    if (langBtn) {
      const next = langBtn.getAttribute("data-lang");
      if (next !== lang) setLang(next);
    }
  });

  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && sheet) closeSheet(); });

  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest(".claim-form");
    if (!form) return;
    ev.preventDefault();
    const isFund = form.hasAttribute("data-fund");
    const giftId = form.getAttribute("data-gift");
    const name = form.elements.name.value.trim();
    const message = form.elements.message.value.trim();
    const t = T();
    if (!name) { formError = t.error_name; render(); return; }
    let amount = 0;
    if (isFund) {
      amount = parseAmount(form.elements.amount.value);
      if (!(amount > 0)) { formError = t.error_amount; render(); return; }
    }
    busy = true; formError = ""; render();
    try {
      const res = isFund
        ? await backend.contribute(name, amount, fundCurrency, message)
        : await backend.claim(giftId, name, message);
      myTokens[res.id] = res.token;
      writeJSON(LS_TOKENS, myTokens);
      openForm = null;
      busy = false;
      dataKey = "";
      await refresh();
      confetti();
      if (isFund) openSheet({ name, amount, currency: fundCurrency, brl: fundCurrency === "USD" ? amount * usdRate : amount });
      else { const g = GIFT_BY_ID.get(giftId); openSheet({ name, amount: g.price, currency: "BRL", brl: g.price }); }
    } catch (e) {
      busy = false;
      formError = (e.code === "P0003") ? t.error_taken : (e.code === "22023" ? t.error_amount : t.error_generic);
      render();
      if (e.code === "P0003") { dataKey = ""; refresh(); }
    }
  });

  window.addEventListener("hashchange", () => {
    const h = (location.hash || "").replace("#", "").toLowerCase();
    if ((h === "en" || h === "pt") && h !== lang) setLang(h);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  if (ONLINE) setInterval(refresh, 20000);
  setInterval(renderCountdown, 1000);

  // ---------- today's exchange rate (free, updates daily; cached for 12 hours) ----------
  function applyRate(r) {
    if (typeof r === "number" && r > 2 && r < 15 && Math.abs(r - usdRate) > 0.001) { usdRate = r; render(); if (sheet) renderSheet(); }
  }
  (function loadRate() {
    const cached = readJSON("lista.fx", null);
    if (cached && Date.now() - cached.at < 12 * 3600 * 1000 && typeof cached.rate === "number") { usdRate = cached.rate; return; }
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json())
      .then(j => {
        const r = j && j.result === "success" && j.rates && j.rates.BRL;
        if (typeof r === "number") { writeJSON("lista.fx", { rate: r, at: Date.now() }); applyRate(r); }
      })
      .catch(() => {});
  })();

  // ---------- go ----------
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  render();
  refresh();
})();
