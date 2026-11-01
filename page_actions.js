// This file is INJECTED into the current page by the extension. It defines
// globalThis.__easyAgent = { fill, click, readFields } so the background script
// can call them after injecting this file. It does the actual work: find a
// field or button by its visible label, fill it, or click it. Same safety
// rules as the C++ agent:
//   - never types into password / OTP / card fields
//   - never clicks Submit / Send / Pay / Apply (the user does that)
//   - the value is treated as text, never run as code
//
// Each function returns {ok, error, seen?} so the extension can report back.

globalThis.__easyAgent = (() => {
  const norm = s => (s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase();

  const labelsOf = el => {
    const out = [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name")];
    if (el.id) document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]').forEach(l => out.push(l.innerText));
    const wrap = el.closest("label");
    if (wrap) out.push(wrap.innerText);
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach(id => { const e = document.getElementById(id); if (e) out.push(e.innerText); });
    const item = el.closest("[role=listitem]");
    if (item) { const h = item.querySelector("[role=heading]"); if (h) out.push(h.innerText); }
    return out.map(norm).filter(Boolean);
  };

  const pick = (elements, want, textsOf) => {
    let partial = null;
    for (const el of elements) {
      const texts = textsOf(el);
      if (texts.some(t => t === want)) return el;
      if (!partial && texts.some(t => t.includes(want))) partial = el;
    }
    return partial;
  };

  function fill(field, value) {
    const want = norm(field);
    const fields = [...document.querySelectorAll("input, textarea, [contenteditable=true]")]
      .filter(el => !["hidden", "submit", "button", "image", "reset", "file", "radio", "checkbox"]
        .includes((el.type || "").toLowerCase()));

    const el = pick(fields, want, labelsOf);
    if (!el) {
      return { ok: false, error: 'no field labelled "' + want + '"',
               seen: fields.map(f => labelsOf(f)[0]).filter(Boolean).slice(0, 15) };
    }
    if ((el.type || "").toLowerCase() === "password") {
      return { ok: false, error: "will not type into password fields" };
    }

    el.scrollIntoView({ block: "center" });
    el.focus();
    if (el.isContentEditable) {
      el.innerText = value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();

    const now = el.isContentEditable ? el.innerText : el.value;
    return { ok: now === value, error: now === value ? "" : "the page did not accept the text" };
  }

  function click(text) {
    // Never click actions that submit / pay / sign in. The user does those.
    const FINAL = ["submit", "send", "pay", "buy", "purchase", "place order", "checkout",
                   "check out", "delete", "confirm", "sign in", "log in", "login", "sign up",
                   "register", "transfer", "donate", "subscribe", "apply now", "apply"];
    const t = norm(text);
    if (FINAL.some(w => t.includes(w))) {
      return { ok: false, error: 'refusing to click "' + text + '": submitting/paying is left to you' };
    }

    const clickable = [...document.querySelectorAll(
      "button, a, input[type=button], input[type=radio], input[type=checkbox], " +
      "[role=button], [role=radio], [role=checkbox], [role=option], [role=link], [role=tab], label")];
    const textsOf = el => [norm(el.innerText), norm(el.value), norm(el.getAttribute("aria-label"))].filter(Boolean);

    const el = pick(clickable, t, textsOf);
    if (!el) return { ok: false, error: 'nothing to click with text "' + t + '"' };

    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, error: "" };
  }

  // Lists the form fields on the page. Text fields report {label, type}; choice
  // questions (radio / checkbox / dropdown, native or Google-Forms ARIA) also
  // report {options:[...]} so the agent's model can pick an allowed answer.
  function readFields() {
    const out = [];
    const seen = new Set();
    const add = (label, type, options) => {
      if (!label || seen.has(label)) return;
      seen.add(label);
      const f = { label, type };
      if (options && options.length) f.options = options;
      out.push(f);
    };

    // 1) Google-Forms-style questions: each is a [role=listitem] with a heading
    // and ARIA radios / checkboxes / a listbox.
    for (const item of document.querySelectorAll("[role=listitem]")) {
      const h = item.querySelector("[role=heading]");
      const label = h ? norm(h.innerText) : "";
      if (!label) continue;
      const radios = [...item.querySelectorAll("[role=radio]")];
      const checks = [...item.querySelectorAll("[role=checkbox]")];
      const listbox = item.querySelector("[role=listbox]");
      if (radios.length) {
        add(label, "radio", radios.map(r => norm(r.getAttribute("aria-label") || r.innerText)).filter(Boolean));
      } else if (checks.length) {
        add(label, "checkbox", checks.map(c => norm(c.getAttribute("aria-label") || c.innerText)).filter(Boolean));
      } else if (listbox) {
        add(label, "select", [...item.querySelectorAll("[role=option]")]
          .map(o => norm(o.innerText || o.getAttribute("aria-label")))
          .filter(t => t && t !== "choose"));
      }
    }

    // 2) Native <select> dropdowns.
    for (const sel of document.querySelectorAll("select")) {
      add(labelsOf(sel)[0] || "", "select",
          [...sel.options].map(o => norm(o.textContent)).filter(t => t && t !== "choose"));
    }

    // 3) Native radio / checkbox groups, grouped by their shared name.
    const groups = {};
    for (const inp of document.querySelectorAll("input[type=radio], input[type=checkbox]")) {
      const key = inp.name || inp.id;
      if (key) (groups[key] = groups[key] || []).push(inp);
    }
    for (const key of Object.keys(groups)) {
      const inputs = groups[key];
      const fs = inputs[0].closest("fieldset");
      const legend = fs ? fs.querySelector("legend") : null;
      const label = legend ? norm(legend.innerText) : norm(key);
      add(label, (inputs[0].type || "").toLowerCase(),
          inputs.map(i => optLabel(i)).filter(Boolean));
    }

    // 4) Text fields (same rich label lookup as fill), skipping anything a
    // choice question above already claimed.
    const textFields = [...document.querySelectorAll("input, textarea, [contenteditable=true]")]
      .filter(el => !["hidden", "submit", "button", "image", "reset", "file", "radio", "checkbox"]
        .includes((el.type || "").toLowerCase()));
    for (const el of textFields) {
      add(labelsOf(el)[0] || "", (el.type || el.tagName).toLowerCase());
    }

    return out.slice(0, 80);
  }

  // The visible label of a single radio/checkbox OPTION (not its question).
  const optLabel = el => {
    const a = norm(el.getAttribute("aria-label"));
    if (a) return a;
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return norm(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap) return norm(wrap.innerText);
    return norm(el.innerText);
  };

  // Selects an option under a choice question. `field` is the question label,
  // `value` the option to pick; multiple checkbox picks may be joined with "|".
  // Handles native <select>, native radio/checkbox, and Google-Forms ARIA.
  function choose(field, value) {
    const want = norm(field);
    const tokens = (value || "").split("|").map(norm).filter(Boolean);
    if (!tokens.length) return { ok: false, error: "no value to choose" };
    const matches = (text, tok) => text === tok || text.includes(tok);

    // Native <select>.
    for (const sel of document.querySelectorAll("select")) {
      if (!labelsOf(sel).some(t => matches(t, want))) continue;
      const opt = [...sel.options].find(o => norm(o.textContent) === tokens[0]) ||
                  [...sel.options].find(o => matches(norm(o.textContent), tokens[0]));
      if (!opt) return { ok: false, error: 'no option "' + tokens[0] + '" under "' + want + '"' };
      sel.scrollIntoView({ block: "center" });
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, error: "" };
    }

    // Find the question's container (Google-Forms listitem or native fieldset).
    let scope = null;
    for (const item of document.querySelectorAll("[role=listitem]")) {
      const h = item.querySelector("[role=heading]");
      if (h && matches(norm(h.innerText), want)) { scope = item; break; }
    }
    if (!scope) {
      for (const fs of document.querySelectorAll("fieldset")) {
        const lg = fs.querySelector("legend");
        if (lg && matches(norm(lg.innerText), want)) { scope = fs; break; }
      }
    }
    const root = scope || document;

    // ARIA dropdown (Google Forms): open the listbox, then click the option.
    const listbox = root.querySelector("[role=listbox]");
    if (listbox) {
      listbox.scrollIntoView({ block: "center" });
      listbox.click();
      const all = [...root.querySelectorAll("[role=option]"), ...document.querySelectorAll("[role=option]")];
      const opt = all.find(o => norm(o.innerText) === tokens[0]) ||
                  all.find(o => matches(norm(o.innerText), tokens[0]));
      if (!opt) return { ok: false, error: 'no option "' + tokens[0] + '" under "' + want + '"' };
      opt.click();
      return { ok: true, error: "" };
    }

    // Radio / checkbox — ARIA or native. Click each requested option.
    const choices = [...root.querySelectorAll(
      "[role=radio], [role=checkbox], input[type=radio], input[type=checkbox]")];
    const labelOf = el => norm(el.getAttribute("aria-label")) || optLabel(el);
    let clicked = 0;
    for (const tok of tokens) {
      const target = choices.find(c => labelOf(c) === tok) || choices.find(c => matches(labelOf(c), tok));
      if (target) { target.scrollIntoView({ block: "center" }); target.click(); clicked++; }
    }
    if (!clicked) return { ok: false, error: 'no choice "' + tokens.join(", ") + '" under "' + want + '"' };
    return { ok: true, error: "" };
  }

  return { fill, click, readFields, choose };
})();

