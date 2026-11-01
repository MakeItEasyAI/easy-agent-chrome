// Background service worker.
//
// This keeps a persistent native-messaging connection to the easy-agent
// "bridge" (the C++ program `easy native-host`, started by Chrome). That bridge
// serves a local socket the terminal `easy` connects to. So you drive
// everything from the terminal:
//
//   terminal `easy fill form`  ──socket──►  bridge  ──this connection──►  this
//   extension  ──►  the page
//
// No network port is opened. When the agent sends a command (read_fields /
// fill / click), we run it on the front tab and reply. Nothing is submitted.

const HOST = "com.makeiteasy.easy_agent";
let port = null;

// Runs one {action,...} command on a tab (the front tab when none is given).
// Looks in all frames, since job forms are often inside an embedded frame.
async function runOnTab(command, tabId) {
  let tab = null;
  if (tabId != null) {
    try { tab = await chrome.tabs.get(tabId); } catch (e) { tab = null; }
  }
  if (!tab) {
    // Prefer the active tab of the front window; fall back to any active
    // web-page tab (the terminal-driven path has no popup to pin the tab).
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !/^https?:/.test(tab.url || "")) {
      const tabs = await chrome.tabs.query({ active: true });
      tab = tabs.find(t => /^https?:/.test(t.url || "")) || tab;
    }
  }
  if (!tab) return { ok: false, error: "no active tab (open the form and keep it in front)" };
  const url = tab.url || "";
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(url)) {
    return { ok: false, error: "the front tab is not a web page (" + (url.split("/")[0] || url) +
             "). Open the form and keep that tab in front." };
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["page_actions.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (cmd) => {
        const a = globalThis.__easyAgent;
        if (!a) return { ok: false, error: "page helper not loaded" };
        if (cmd.action === "fill") return a.fill(cmd.field, cmd.value);
        if (cmd.action === "click") return a.click(cmd.text);
        if (cmd.action === "read_fields") return a.readFields();
        return { ok: false, error: "unknown action: " + cmd.action };
      },
      args: [command],
    });
    if (command.action === "read_fields") {
      const merged = [];
      for (const r of results) if (Array.isArray(r.result)) merged.push(...r.result);
      return merged;
    }
    let firstError = null;
    for (const r of results) {
      if (r.result && r.result.ok) return r.result;
      if (!firstError && r.result && r.result.error) firstError = r.result;
    }
    return firstError || { ok: false, error: "no frame could do that" };
  } catch (e) {
    return { ok: false, error: String(e) + " (on " + (url.split("?")[0] || "this tab") + ")" };
  }
}

// Stay connected to the agent bridge so the terminal can reach the browser.
function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    setTimeout(connect, 5000);   // agent not installed yet; try again later
    return;
  }
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "command") {
      const result = await runOnTab(msg, null);   // the front tab (your form)
      if (port) port.postMessage({ type: "result", id: msg.id, result });
    }
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;                 // handled: no console warning
    port = null;
    setTimeout(connect, 3000);                     // bridge closed; reconnect
  });
}
connect();

// Reconnect when Chrome starts or the extension (re)loads, so the bridge comes
// back up without needing the popup.
chrome.runtime.onStartup.addListener(() => { if (!port) connect(); });
chrome.runtime.onInstalled.addListener(() => { if (!port) connect(); });

// Manual popup helpers (Check agent / List fields) for debugging.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.from === "popup") {
    runOnTab(msg.command, msg.tabId).then(sendResponse);
    return true;
  }
});
