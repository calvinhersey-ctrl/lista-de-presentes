(function () {
  "use strict";

  const C = window.CONTENT;
  const CFG = window.CONFIG || {};
  const ONLINE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const LS_LANG = "lista.lang";
  const LS_TOKENS = "lista.tokens";   // { claimId: undoToken } for claims made on this device
  const LS_LOCAL = "lista.localClaims"; // test mode only

  // ---------- language ----------
  function pickLang() {
    const h = (location.hash || "").replace("#", "").toLowerCase();
    if (h === "en" || h === "pt") return h;
    try { const s = localStorage.getItem(LS_LANG); if (s === "en" || s === "pt") return s; } catch (e) {}
    const nav = (navigator.language || "pt").toLowerCase();
    return nav.startsWith("en") ? "en" : "pt";
  }
  let lang = pickLang();
  const T = () => C.ui[lang];

  function setLang(next) {
    lang = next;
    try { localStorage.setItem(LS_LANG, lang); } catch (e) {}
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    render();
  }

  // ---------- storage ----------
  function readJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  let myTokens = readJSON(LS_TOKENS, {});

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
      return sb("/rest/v1/claims?select=id,gift_id,giver_name,message,created_at&order=created_at.asc");
    },
    async claim(giftId, name, message) {
      const rows = await sb("/rest/v1/rpc/claim_gift", {
        method: "POST",
        body: JSON.stringify({ p_gift_id: giftId, p_name: name, p_message: message || null }),
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
    async claim(giftId, name, message) {
      const all = readJSON(LS_LOCAL, []);
      const gift = C.gifts.find(g => g.id === giftId);
      const taken = all.filter(c => c.gift_id === giftId).length;
      if (!gift || taken >= gift.qty) { const e = new Error("taken"); e.code = "P0003"; throw e; }
      const id = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      all.push({ id, gift_id: giftId, giver_name: name, message: message || null, created_at: new Date().toISOString() });
      writeJSON(LS_LOCAL, all);
      return { id, token: "local" };
    },
    async unclaim(claimId) {
      writeJSON(LS_LOCAL, readJSON(LS_LOCAL, []).filter(c => c.id !== claimId));
      return true;
    },
  };

  // ---------- state ----------
  let claims = [];
  let openForm = null;   // gift id whose claim form is open
  let formError = "";
  let busy = false;

  async function refresh() {
    try {
      claims = await backend.list() || [];
      render();
    } catch (e) {
      // keep showing the last good list
    }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtPrice(brl) {
    const t = T();
    if (lang === "pt") return "R$ " + brl.toLocaleString("pt-BR");
    const usd = Math.round(brl / C.usd_rate);
    return "R$" + brl.toLocaleString("en-US") + `<small>${t.approx} US$${usd.toLocaleString("en-US")}</small>`;
  }
  function claimsFor(giftId) { return claims.filter(c => c.gift_id === giftId); }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
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
    document.getElementById("steps").innerHTML = t.how_steps.map(s => `<li>${esc(s)}</li>`).join("");
    const lt = document.getElementById("lang-toggle");
    lt.textContent = t.switch_to;
    lt.setAttribute("aria-label", t.switch_to);
    const off = document.getElementById("offline");
    off.hidden = ONLINE;
    off.textContent = t.offline;
    document.title = (lang === "pt" ? "Lista de presentes" : "Gift list") + " · " + C.couple;
  }

  function cardHTML(g) {
    const t = T();
    const taken = claimsFor(g.id);
    const left = g.qty - taken.length;
    const name = g.name[lang];
    let partial = "";
    if (g.qty > 1) {
      const pill = `<span class="pill soft">${esc(t.remaining(left))}</span>`;
      const names = taken.map(c => `<b>${esc(c.giver_name)}</b>`).join(", ");
      partial = pill + (taken.length ? `<p class="partial">${esc(t.gave_by)} ${names}</p>` : "");
    }
    let action;
    if (openForm === g.id) {
      action = `
        <form class="claim-form" data-gift="${esc(g.id)}">
          <label>${esc(t.name_label)}
            <input type="text" name="name" id="name-${esc(g.id)}" maxlength="60" required autocomplete="name" placeholder="${esc(t.name_placeholder)}">
          </label>
          <label>${esc(t.message_label)}
            <textarea name="message" id="msg-${esc(g.id)}" maxlength="300" placeholder="${esc(t.message_placeholder)}"></textarea>
          </label>
          ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
          <div class="row">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(t.cancel)}</button>
            <button type="submit" class="btn btn-primary" ${busy ? "disabled" : ""}>${esc(busy ? t.saving : t.confirm)}</button>
          </div>
        </form>`;
    } else {
      action = `<button type="button" class="btn btn-primary" data-claim="${esc(g.id)}">🎁 ${esc(t.claim)}</button>`;
    }
    return `
      <article class="card" id="gift-${esc(g.id)}">
        <div class="card-img"><img src="${esc(g.image)}" alt="${esc(name)}" loading="lazy"></div>
        <div class="card-body">
          <h3>${esc(name)}</h3>
          <p class="why">${esc(g.why[lang])}</p>
          <div class="meta">
            <span class="price">${fmtPrice(g.price)}</span>
            <a class="store-link" href="${esc(g.url)}" target="_blank" rel="noopener">${esc(t.store)} ↗<span class="store-name">${esc(g.store)}</span></a>
          </div>
          ${partial}
          ${action}
        </div>
      </article>`;
  }

  function givenHTML() {
    const t = T();
    const byGift = new Map(C.gifts.map(g => [g.id, g]));
    return claims.slice().reverse().map(c => {
      const g = byGift.get(c.gift_id);
      if (!g) return "";
      const mine = myTokens[c.id];
      return `
        <li>
          <img src="${esc(g.image)}" alt="">
          <div>
            <p class="g-name">${esc(g.name[lang])}</p>
            <p class="g-by">${esc(t.gave_by)} <b>${esc(c.giver_name)}</b></p>
            ${c.message ? `<p class="g-msg">“${esc(c.message)}”</p>` : ""}
            ${mine ? `<p class="g-undo"><button type="button" class="btn-link" data-undo="${esc(c.id)}">${esc(t.undo)}</button></p>` : ""}
          </div>
        </li>`;
    }).join("");
  }

  function render() {
    renderStatic();
    const t = T();
    const available = C.gifts.filter(g => claimsFor(g.id).length < g.qty);
    document.getElementById("available").innerHTML = available.map(cardHTML).join("");
    document.getElementById("available-count").textContent = available.length ? `(${available.length})` : "";
    document.getElementById("none-left").hidden = available.length > 0;

    const gs = document.getElementById("given-section");
    gs.hidden = claims.length === 0;
    document.getElementById("given").innerHTML = givenHTML();

    if (openForm) {
      const input = document.getElementById("name-" + openForm);
      if (input && document.activeElement !== input && !input.value) input.focus();
    }
  }

  // ---------- events ----------
  document.addEventListener("click", async (ev) => {
    const claimBtn = ev.target.closest("[data-claim]");
    if (claimBtn) {
      openForm = claimBtn.getAttribute("data-claim");
      formError = "";
      render();
      document.getElementById("gift-" + openForm)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (ev.target.closest("[data-cancel]")) {
      openForm = null; formError = ""; render(); return;
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
      await refresh();
      return;
    }
    if (ev.target.closest("#lang-toggle")) {
      setLang(lang === "pt" ? "en" : "pt");
    }
  });

  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest(".claim-form");
    if (!form) return;
    ev.preventDefault();
    const giftId = form.getAttribute("data-gift");
    const name = form.elements.name.value.trim();
    const message = form.elements.message.value.trim();
    const t = T();
    if (!name) { formError = t.error_name; render(); return; }
    busy = true; formError = ""; render();
    try {
      const res = await backend.claim(giftId, name, message);
      myTokens[res.id] = res.token;
      writeJSON(LS_TOKENS, myTokens);
      openForm = null;
      busy = false;
      await refresh();
      toast(t.thanks(name));
      document.getElementById("given-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) {
      busy = false;
      formError = (e.code === "P0003") ? t.error_taken : t.error_generic;
      render();
      if (e.code === "P0003") refresh();
    }
  });

  window.addEventListener("hashchange", () => {
    const h = (location.hash || "").replace("#", "").toLowerCase();
    if ((h === "en" || h === "pt") && h !== lang) setLang(h);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  if (ONLINE) setInterval(refresh, 20000);

  // ---------- go ----------
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  render();
  refresh();
})();
