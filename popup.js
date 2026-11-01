// Popup UI. Two paths:
//   - Run: send a task to the agent (via background) and stream its progress.
//   - Manual Fill / List fields / Check agent: direct, for testing.

const HOST = "com.makeiteasy.easy_agent";

const show = (obj) => { document.getElementById("result").textContent = JSON.stringify(obj, null, 2); };
const logLine = (text) => {
  const box = document.getElementById("log");
  box.textContent += (box.textContent ? "\n" : "") + text;
};

// --- task flow ---
document.getElementById("run").addEventListener("click", () => {
  const task = document.getElementById("task").value.trim();
  const resume = document.getElementById("resume").value.trim();
  if (!task) return logLine("Type what to do first.");
  document.getElementById("log").textContent = "";
  logLine("Working...");

  const port = chrome.runtime.connect({ name: "task" });
  port.onMessage.addListener((msg) => {
    if (msg.type === "log") logLine(msg.message);
    else if (msg.type === "error") logLine("Error: " + msg.message);
    else if (msg.type === "done") {
      logLine((msg.ok ? "✓ " : "✗ ") + msg.message);
      port.disconnect();
    }
  });
  port.postMessage({ type: "task", task, resume });
});

// --- manual helpers ---
const send = (command) =>
  chrome.runtime.sendMessage({ from: "popup", command }).then(show).catch(e => show({ ok: false, error: String(e) }));

document.getElementById("fill").addEventListener("click", () => {
  const field = document.getElementById("field").value.trim();
  const value = document.getElementById("value").value;
  if (!field) return show({ ok: false, error: "enter a field label" });
  send({ action: "fill", field, value });
});

document.getElementById("list").addEventListener("click", () => send({ action: "read_fields" }));

document.getElementById("ping").addEventListener("click", () => {
  try {
    chrome.runtime.sendNativeMessage(HOST, { type: "ping" }, (reply) => {
      if (chrome.runtime.lastError) {
        show({ ok: false, error: "agent not reachable: " + chrome.runtime.lastError.message });
      } else {
        show({ ok: true, agent: reply });
      }
    });
  } catch (e) {
    show({ ok: false, error: String(e) });
  }
});
