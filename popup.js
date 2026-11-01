// Minimal UI to test the extension WITHOUT the C++ agent: fill one field, or
// list the fields on the page. The real driver is the agent via background.js.

const show = (obj) => { document.getElementById("result").textContent = JSON.stringify(obj, null, 2); };

const send = (command) =>
  chrome.runtime.sendMessage({ from: "popup", command }).then(show).catch(e => show({ ok: false, error: String(e) }));

document.getElementById("fill").addEventListener("click", () => {
  const field = document.getElementById("field").value.trim();
  const value = document.getElementById("value").value;
  if (!field) return show({ ok: false, error: "enter a field label" });
  send({ action: "fill", field, value });
});

document.getElementById("list").addEventListener("click", () => send({ action: "read_fields" }));
