(function () {
  "use strict";

  const C = window.CONTENT;
  const CFG = window.CONFIG || {};
  // Add ?test to the address to try the page without touching the shared list.
  const TEST_MODE = /[?&]test\b/.test(location.search);
  const ONLINE = !TEST_MODE && !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const LS_LANG = "lista.lang";
  const LS_SIDE = "lista.side";
  const LS_TOKENS = "lista.tokens";     // { claimId: undoToken } for claims made on this device
  const LS_LOCAL = "lista.localClaims"; // test mode only
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ROOM_ICON = { cozinha: "🍳", sala: "🛋️", quartos: "🛏️", banheiro: "🚿" };
  const FILTERS = ["all", "cozinha", "sala", "quartos", "banheiro", "budget"];
  const FILTER_ICON = { all: "🏠", cozinha: "🍳", sala: "🛋️", quartos: "🛏️", banheiro: "🚿", budget: "💸" };
  const BUDGET_MAX = 150;
  const TEAM_FLAG = { bruna: "🇧🇷", calvin: "🇺🇸" };

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
  }

  function defaultSide() {
    const s = readStr(LS_SIDE);
    if (s === "bruna" || s === "calvin") return s;
    return lang === "en" ? "calvin" : "bruna";
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

  const backend = ONLINE ? {
    async list() {
      return sb("/rest/v1/claims?select=id,gift_id,giver_name,message,side,created_at&order=created_at.asc");
    },
    async claim(giftId, name, message, side) {
      const rows = await sb("/rest/v1/rpc/claim_gift", {
        method: "POST",
        body: JSON.stringify({ p_gift_id: giftId, p_name: name, p_message: message || null, p_side: side || null }),
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return { id: row.claim_id, token: row.undo_token };
    },
    async unclaim(claimId, token) {
      return sb("/rest/v1/rpc/unclaim_gift", {
        method: "POST",
        body: JSON.stringify({ p_claim_id: claimId, p_token: token }),
      });
    },
  } : {
    async list() { return readJSON(LS_LOCAL, []); },
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
    async unclaim(claimId) {
      writeJSON(LS_LOCAL, readJSON(LS_LOCAL, []).filter(c => c.id !== claimId));
      return true;
    },
  };

  // ---------- state ----------
  const GIFT_BY_ID = new Map(C.gifts.map(g => [g.id, g]));
  let claims = [];
  let claimsKey = "";
  let openForm = null;   // gift id whose claim form is open
  let formError = "";
  let busy = false;
  let filter = "all";
  let animateNext = true; // play entrance animations on first paint and filter changes only
  let usdRate = C.usd_rate || 5; // reais per US dollar; replaced by today's rate when it loads
  let loadedOnce = false;  // has the shared list loaded at least once?
  let loadFailed = false;

  async function refresh() {
    try {
      const list = (await backend.list() || []).filter(c => GIFT_BY_ID.has(c.gift_id));
      const wasFailed = loadFailed;
      loadedOnce = true;
      loadFailed = false;
      const key = JSON.stringify(list.map(c => [c.id, c.side]));
      if (key === claimsKey && !wasFailed) return; // nothing changed, don't disturb anyone typing
      claims = list;
      claimsKey = key;
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
  function brl(n) { return lang === "pt" ? "R$ " + n.toLocaleString("pt-BR") : "R$" + n.toLocaleString("en-US"); }
  function usd(n) {
    const v = Math.round(n / usdRate);
    return lang === "pt" ? "US$ " + v.toLocaleString("pt-BR") : "US$" + v.toLocaleString("en-US");
  }
  function rateText() {
    return usdRate.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function claimsFor(giftId) { return claims.filter(c => c.gift_id === giftId); }
  function leftOf(g) { return g.qty - claimsFor(g.id).length; }
  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function daysToChristmas() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let xmas = new Date(now.getFullYear(), 11, 25);
    if (today > xmas) xmas = new Date(now.getFullYear() + 1, 11, 25);
    return Math.round((xmas - today) / 86400000);
  }
  function matchesFilter(g) {
    if (filter === "all") return true;
    if (filter === "budget") return g.price <= BUDGET_MAX;
    return g.room === filter;
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

  // ---------- render ----------
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
    const cd = document.getElementById("countdown");
    const days = daysToChristmas();
    cd.textContent = t.countdown(days);
    cd.hidden = false;
    const le = document.getElementById("load-error");
    le.hidden = !loadFailed;
    le.textContent = t.load_error;
    const off = document.getElementById("offline");
    off.hidden = ONLINE;
    off.textContent = t.offline;
    document.title = (lang === "pt" ? "Lista de presentes" : "Gift list") + " · " + C.couple;
  }

  function renderPay() {
    const t = T();
    const P = C.payment || {};
    const box = document.getElementById("paybox");
    const cards = [];
    if (P.pix) {
      cards.push(`
        <div class="pay-card pay-pix">
          <p class="pay-kind">🇧🇷 ${esc(t.pay_pix)}</p>
          <p class="pay-label">${esc(t.pay_pix_name)}${P.pix_holder ? ` · <span translate="no">${esc(P.pix_holder)}</span>` : ""}</p>
          <div class="pay-row"><code class="pay-value" id="pay-pix" translate="no">${esc(P.pix)}</code>
          <button type="button" class="btn btn-primary pay-copy" data-copy="pay-pix">${esc(t.pay_copy)}</button></div>
        </div>`);
    }
    const us = [];
    if (P.zelle) us.push(`<div class="pay-row"><span class="pay-tag">Zelle</span><code class="pay-value" id="pay-zelle" translate="no">${esc(P.zelle)}</code>
      <button type="button" class="btn btn-primary pay-copy" data-copy="pay-zelle">${esc(t.pay_copy)}</button></div>`);
    if (P.venmo) {
      const handle = String(P.venmo).replace(/^@/, "");
      us.push(`<div class="pay-row"><span class="pay-tag">Venmo</span><code class="pay-value" id="pay-venmo" translate="no">@${esc(handle)}</code>
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
    box.hidden = cards.length === 0;
    document.getElementById("pay-grid").innerHTML = cards.join("");
  }

  function renderScore() {
    const t = T();
    const totalUnits = C.gifts.reduce((a, g) => a + g.qty, 0);
    const done = Math.min(claims.length, totalUnits);
    const pct = totalUnits ? Math.round((done / totalUnits) * 100) : 0;
    document.getElementById("done-num").textContent = done;
    document.getElementById("progress-label").textContent = t.progress_label(done, totalUnits);
    document.getElementById("bar-fill").style.width = pct + "%";
    const bar = document.getElementById("bar");
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-label", `${done} / ${totalUnits}`);
    document.getElementById("progress-sub").textContent = done >= totalUnits ? t.progress_done : t.progress_sub;

    const b = claims.filter(c => c.side === "bruna").length;
    const c = claims.filter(c => c.side === "calvin").length;
    document.getElementById("score-b").textContent = b;
    document.getElementById("score-c").textContent = c;
    let share = (b + c) ? (b / (b + c)) * 100 : 50;
    share = Math.max(8, Math.min(92, share));
    document.getElementById("tug-b").style.width = share + "%";
    document.getElementById("tug-c").style.width = (100 - share) + "%";
    document.getElementById("tug-knot").style.left = share + "%";
    document.querySelector(".team-b").classList.toggle("leading", b > c);
    document.querySelector(".team-c").classList.toggle("leading", c > b);
  }

  function renderFilters(available) {
    const t = T();
    document.getElementById("filters").innerHTML = FILTERS.map(f => {
      const n = available.filter(g => f === "all" ? true : f === "budget" ? g.price <= BUDGET_MAX : g.room === f).length;
      const on = f === filter;
      return `<button type="button" class="chip${on ? " is-on" : ""}" data-filter="${f}" aria-pressed="${on}">${FILTER_ICON[f]} ${esc(t.filters[f])} <span class="n">${n}</span></button>`;
    }).join("");
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
      const side = defaultSide();
      action = `
        <form class="claim-form" data-gift="${esc(g.id)}">
          <label class="f">${esc(t.name_label)}
            <input type="text" name="name" id="name-${esc(g.id)}" maxlength="60" required autocomplete="name" placeholder="${esc(t.name_placeholder)}">
          </label>
          <fieldset class="team-pick">
            <legend>${esc(t.team_label)}</legend>
            <label class="tp tp-b"><input type="radio" name="side" value="bruna" id="side-b-${esc(g.id)}" aria-label="${esc(t.team_bruna)}" ${side === "bruna" ? "checked" : ""}><span>🇧🇷 ${esc(t.team_bruna)}</span></label>
            <label class="tp tp-c"><input type="radio" name="side" value="calvin" id="side-c-${esc(g.id)}" aria-label="${esc(t.team_calvin)}" ${side === "calvin" ? "checked" : ""}><span>🇺🇸 ${esc(t.team_calvin)}</span></label>
          </fieldset>
          <label class="f">${esc(t.message_label)}
            <textarea name="message" id="msg-${esc(g.id)}" maxlength="300" placeholder="${esc(t.message_placeholder)}"></textarea>
          </label>
          ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
          <div class="row">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(t.cancel)}</button>
            <button type="submit" class="btn btn-primary" ${busy ? "disabled" : ""}>${busy ? esc(t.saving) : "🎉 " + esc(t.confirm)}</button>
          </div>
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

  function leaderboardHTML(anim) {
    const t = T();
    const people = new Map();
    claims.forEach((c, idx) => {
      const key = c.giver_name.trim().toLowerCase().replace(/\s+/g, " ");
      if (!people.has(key)) people.set(key, { name: c.giver_name.trim(), count: 0, side: null, first: idx });
      const p = people.get(key);
      p.count += 1;
      if (c.side) p.side = c.side;
    });
    const ranked = [...people.values()].sort((a, b) => b.count - a.count || a.first - b.first).slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    return ranked.map((p, i) => {
      const team = p.side ? `${TEAM_FLAG[p.side]} ${esc(p.side === "bruna" ? t.team_bruna : t.team_calvin)}` : "";
      return `
        <li class="${i === 0 ? "top1 " : ""}${anim ? "anim" : ""}" style="--i:${i}">
          ${i < 3 ? `<span class="medal m" aria-label="${i + 1}">${medals[i]}</span>` : `<span class="medal">${i + 1}</span>`}
          <div class="lb-who">
            <p class="lb-name" translate="no">${esc(p.name)}</p>
            ${team ? `<p class="lb-team">${team}</p>` : ""}
          </div>
          <span class="lb-count">${esc(t.gifts_count(p.count))}</span>
        </li>`;
    }).join("");
  }

  function muralHTML() {
    const t = T();
    return claims.slice().reverse().map(c => {
      const g = GIFT_BY_ID.get(c.gift_id);
      if (!g) return "";
      const mine = myTokens[c.id];
      const tilt = ((hash(c.id) % 9) - 4) * 0.8;
      return `
        <li style="--tilt:${tilt.toFixed(1)}deg">
          ${c.side ? `<span class="m-team" aria-hidden="true">${TEAM_FLAG[c.side]}</span>` : ""}
          <img src="${esc(g.image)}" alt="">
          <p class="m-by"><span translate="no">${esc(c.giver_name)}</span> <span class="heart">♥</span></p>
          <p class="m-gift">${esc(g.name[lang])}</p>
          ${c.message ? `<p class="m-msg">“${esc(c.message)}”</p>` : ""}
          ${mine ? `<p class="m-undo"><button type="button" class="btn-link" data-undo="${esc(c.id)}">${esc(t.undo)}</button></p>` : ""}
        </li>`;
    }).join("");
  }

  function captureForm() {
    const form = document.querySelector(".claim-form");
    if (!form) return null;
    const side = form.querySelector('input[name="side"]:checked');
    return {
      gift: form.getAttribute("data-gift"),
      name: form.elements.name.value,
      message: form.elements.message.value,
      side: side ? side.value : null,
      focus: document.activeElement && form.contains(document.activeElement) ? document.activeElement.name : null,
    };
  }
  function restoreForm(saved) {
    if (!saved) return;
    const form = document.querySelector(`.claim-form[data-gift="${CSS.escape(saved.gift)}"]`);
    if (!form) return;
    form.elements.name.value = saved.name;
    form.elements.message.value = saved.message;
    if (saved.side) {
      const r = form.querySelector(`input[name="side"][value="${saved.side}"]`);
      if (r) r.checked = true;
    }
    if (saved.focus && form.elements[saved.focus] && form.elements[saved.focus].focus) {
      const el = form.elements[saved.focus];
      if (el.focus) el.focus();
    }
  }

  function render() {
    const saved = captureForm();
    const anim = animateNext && !REDUCED;
    animateNext = false;

    renderStatic();
    renderPay();
    renderScore();

    document.getElementById("rate-note").textContent = T().rate_note(rateText());
    const available = C.gifts.filter(g => leftOf(g) > 0);
    renderFilters(available);
    const shown = available.filter(matchesFilter);
    document.getElementById("available").innerHTML = shown.map((g, i) => cardHTML(g, i, anim)).join("");
    document.getElementById("available-count").textContent = available.length ? `(${available.length})` : "";
    document.getElementById("none-left").hidden = available.length > 0;
    document.getElementById("filter-empty").hidden = !(available.length > 0 && shown.length === 0);

    const lb = leaderboardHTML(anim);
    document.getElementById("lb").innerHTML = lb;
    document.getElementById("lb-empty").hidden = lb.trim() !== "";

    document.getElementById("given-section").hidden = claims.length === 0;
    document.getElementById("given").innerHTML = muralHTML();

    restoreForm(saved);
    if (openForm && !saved) {
      const input = document.getElementById("name-" + openForm);
      if (input) input.focus({ preventScroll: true });
    }
  }

  // ---------- events ----------
  document.addEventListener("click", async (ev) => {
    const claimBtn = ev.target.closest("[data-claim]");
    if (claimBtn) {
      openForm = claimBtn.getAttribute("data-claim");
      formError = "";
      render();
      document.getElementById("gift-" + openForm)?.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
      return;
    }
    if (ev.target.closest("[data-cancel]")) {
      openForm = null; formError = ""; render(); return;
    }
    const copyBtn = ev.target.closest("[data-copy]");
    if (copyBtn) {
      const el = document.getElementById(copyBtn.getAttribute("data-copy"));
      const text = el ? el.textContent.trim() : "";
      const done = () => { const old = copyBtn.textContent; copyBtn.textContent = T().pay_copied; setTimeout(() => { copyBtn.textContent = old; }, 1800); };
      const select = () => { try { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {} };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, select);
      else select();
      return;
    }
    const chip = ev.target.closest("[data-filter]");
    if (chip) {
      const f = chip.getAttribute("data-filter");
      if (f !== filter) { filter = f; animateNext = true; render(); }
      return;
    }
    const undoBtn = ev.target.closest("[data-undo]");
    if (undoBtn) {
      const id = undoBtn.getAttribute("data-undo");
      const token = myTokens[id];
      undoBtn.disabled = true;
      try {
        await backend.unclaim(id, token);
        delete myTokens[id];
        writeJSON(LS_TOKENS, myTokens);
        toast(T().undo_done);
      } catch (e) {
        toast(T().error_generic);
      }
      claimsKey = "";
      await refresh();
      return;
    }
    const langBtn = ev.target.closest("[data-lang]");
    if (langBtn) {
      const next = langBtn.getAttribute("data-lang");
      if (next !== lang) setLang(next);
    }
  });

  document.addEventListener("change", (ev) => {
    if (ev.target.matches && ev.target.matches('.claim-form input[name="side"]')) writeStr(LS_SIDE, ev.target.value);
  });

  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest(".claim-form");
    if (!form) return;
    ev.preventDefault();
    const giftId = form.getAttribute("data-gift");
    const name = form.elements.name.value.trim();
    const message = form.elements.message.value.trim();
    const sideEl = form.querySelector('input[name="side"]:checked');
    const side = sideEl ? sideEl.value : null;
    const t = T();
    if (!name) { formError = t.error_name; render(); return; }
    if (side) writeStr(LS_SIDE, side);
    busy = true; formError = ""; render();
    try {
      const res = await backend.claim(giftId, name, message, side);
      myTokens[res.id] = res.token;
      writeJSON(LS_TOKENS, myTokens);
      openForm = null;
      busy = false;
      claimsKey = "";
      await refresh();
      confetti();
      toast(`${t.thanks(name)} ${t.confetti_note}`);
      document.getElementById("given-section")?.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
    } catch (e) {
      busy = false;
      formError = (e.code === "P0003") ? t.error_taken : t.error_generic;
      render();
      if (e.code === "P0003") { claimsKey = ""; refresh(); }
    }
  });

  window.addEventListener("hashchange", () => {
    const h = (location.hash || "").replace("#", "").toLowerCase();
    if ((h === "en" || h === "pt") && h !== lang) setLang(h);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  if (ONLINE) setInterval(refresh, 20000);

  // ---------- today's exchange rate (free, updates daily; cached for 12 hours) ----------
  function applyRate(r) {
    if (typeof r === "number" && r > 2 && r < 15 && Math.abs(r - usdRate) > 0.001) { usdRate = r; render(); }
  }
  (function loadRate() {
    const cached = readJSON("lista.fx", null);
    if (cached && Date.now() - cached.at < 12 * 3600 * 1000) { usdRate = cached.rate; return; }
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
