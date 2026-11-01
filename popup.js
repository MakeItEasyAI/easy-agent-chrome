// Small checks for debugging. The real driving happens in the terminal
// (`easy fill form`). These buttons never submit anything.

const HOST = "com.makeiteasy.easy_agent";
const show = (obj) => { document.getElementById("result").textContent = JSON.stringify(obj, null, 2); };

const activeTabId = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
};

// List the fields on the current page (to see what the agent sees).
document.getElementById("list").addEventListener("click", async () => {
  const tabId = await activeTabId();
  chrome.runtime.sendMessage({ from: "popup", command: { action: "read_fields" }, tabId })
    .then(show).catch(e => show({ ok: false, error: String(e) }));
});

// Is the C++ agent reachable?
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
