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

  // Lists the form fields on the page (labels only), so the agent can see what
  // is there before filling.
  function readFields() {
    const trim = s => (s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
    const out = [];
    document.querySelectorAll("input, textarea, select, [contenteditable=true]").forEach(el => {
      const type = (el.type || el.tagName).toLowerCase();
      if (type === "hidden") return;
      let label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "";
      const wrap = el.closest("label");
      if (!label && wrap) label = wrap.innerText;
      label = trim(label);
      if (label) out.push({ label, type });
    });
    return out.slice(0, 60);
  }

  return { fill, click, readFields };
})();

