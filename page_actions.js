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
    const out = [];
    // Human-readable labels FIRST, so a field shows as "Country code", not the
    // machine name "mobilephone.countrycode".
    if (el.id) document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]').forEach(l => out.push(l.innerText));
    const wrap = el.closest("label");
    if (wrap) out.push(wrap.innerText);
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach(id => { const e = document.getElementById(id); if (e) out.push(e.innerText); });
    const item = el.closest("[role=listitem]");
    if (item) { const h = item.querySelector("[role=heading]"); if (h) out.push(h.innerText); }
    // A <label> in the field's immediate container, even when not linked by
    // for= (common in React-based ATS forms).
    for (let node = el.parentElement, i = 0; node && i < 3; node = node.parentElement, i++) {
      const lbl = node.querySelector("label");
      if (lbl && !lbl.contains(el)) { out.push(lbl.innerText); break; }
    }
    // Attribute fallbacks last; the machine name is the very last resort.
    out.push(el.getAttribute("aria-label"));
    out.push(el.getAttribute("title"));
    out.push(el.getAttribute("placeholder"));
    // Rich editors (Instagram/WhatsApp message boxes) label themselves with
    // aria-placeholder, e.g. "Message...", not a real placeholder.
    out.push(el.getAttribute("aria-placeholder"));
    out.push(el.getAttribute("name"));
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
    const fields = [...document.querySelectorAll(
      "input, textarea, [contenteditable]:not([contenteditable=false]), [role=textbox]")]
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
      // Rich editors (Instagram/WhatsApp-web message boxes, etc.) ignore a plain
      // innerText set — insert through the browser's text pipeline so the editor
      // registers it. Fall back to innerText if that is unavailable.
      try { document.execCommand("selectAll", false, null); } catch (e) { /* ignore */ }
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, value); } catch (e) { inserted = false; }
      if (!inserted) el.innerText = value;
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    } else {
      // A role=textbox that isn't a real input/contenteditable: last-resort text set.
      el.textContent = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (!el.isContentEditable) el.blur();   // don't blur a message box; keep it ready to send

    const now = el.isContentEditable ? (el.innerText || el.textContent || "") : el.value;
    const ok = now === value || now.includes(value);
    return { ok, error: ok ? "" : "the page did not accept the text" };
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
    const textFields = [...document.querySelectorAll(
      "input, textarea, [contenteditable]:not([contenteditable=false]), [role=textbox]")]
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

  return { fill, click, readFields, choose, readPage, readContent };

  // A text+links snapshot of the page for "collect jobs": the visible text
  // (what you can see/scrolled to) plus every real link with its URL, so the
  // agent's model can spot job postings and "we're hiring" posts and pair each
  // with its apply link or the author to contact. Read-only; touches nothing.
  function readContent() {
    const text = (document.body ? document.body.innerText : "")
      .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 15000);
    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = (a.href || "").split("#")[0];
      if (!/^https?:/.test(href) || seen.has(href)) continue;
      const t = (a.innerText || a.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ").trim().slice(0, 120);
      seen.add(href);
      links.push({ text: t, href });
      if (links.length >= 80) break;
    }
    return { text, links };
  }

  // A compact view of the page for web_do: the fillable fields plus the visible
  // text of clickable things (links, buttons, tabs, search results). Lets the
  // model decide the next click/fill without being told the exact target.
  function readPage() {
    const fields = readFields();
    const clickables = [];
    const seen = new Set();
    const sel = "button, a, [role=button], [role=link], [role=tab], [role=menuitem], " +
                "[role=option], input[type=submit], input[type=button]";
    for (const el of document.querySelectorAll(sel)) {
      const t = norm(el.innerText || el.getAttribute("aria-label") || el.value);
      if (t && t.length >= 1 && t.length <= 80 && !seen.has(t)) {
        seen.add(t);
        clickables.push(t);
        if (clickables.length >= 50) break;
      }
    }
    return { fields, clickables };
  }
})();

