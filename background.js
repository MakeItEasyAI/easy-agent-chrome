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

// Timestamped log so the service-worker console tells the connect/disconnect
// story even after the worker is recycled.
function log(msg) {
  console.log("[easy " + new Date().toLocaleTimeString() + "] " + msg);
  try { if (port) port.postMessage({ type: "log", text: msg }); } catch (e) { /* no port */ }
}

// Runs one {action,...} command on a tab (the front tab when none is given).
// Looks in all frames, since job forms are often inside an embedded frame.
async function runOnTab(command, tabId) {
  let tab = null;
  if (tabId != null) {
    try { tab = await chrome.tabs.get(tabId); } catch (e) { tab = null; }
  }
  // When the agent gives a URL, operate ONLY on that URL's tab — match it, or
  // open it. NEVER fall back to whatever tab happens to be active: that could
  // fill some OTHER page you have open (e.g. a real job application).
  if (!tab && command && command.url) {
    const base = command.url.split("#")[0];
    const noQuery = base.split("?")[0];
    const all = await chrome.tabs.query({});
    tab = all.find(t => (t.url || "").split("#")[0] === base) ||
          all.find(t => (t.url || "").startsWith(noQuery));
    if (tab) {
      log("matched form tab " + tab.id + " by url");
    } else {
      log("form tab not open; opening it");
      const created = await chrome.tabs.create({ url: command.url, active: true });
      await new Promise(r => setTimeout(r, 1500));
      try { tab = await chrome.tabs.get(created.id); } catch (e) { tab = created; }
    }
    if (!tab) return { ok: false, error: "could not open the form tab for " + command.url };
  } else if (!tab) {
    // No URL given: act on the tab you're looking at (fill the current form).
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !/^https?:/.test(tab.url || "")) {
      const tabs = await chrome.tabs.query({ active: true });
      tab = tabs.find(t => /^https?:/.test(t.url || "")) || tab;
    }
    if (!tab) return { ok: false, error: "no active tab (open the form and keep it in front)" };
  }
  const url = tab.url || "";
  log("runOnTab: tab " + tab.id + " url=" + (url.split("?")[0] || url));
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(url)) {
    return { ok: false, error: "the front tab is not a web page (" + (url.split("/")[0] || url) +
             "). Open the form and keep that tab in front." };
  }

  // Wait for the page to finish loading before touching it (a freshly opened
  // page, especially a heavy SPA like YouTube, is not ready immediately).
  for (let i = 0; i < 20 && tab.status && tab.status !== "complete"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { tab = await chrome.tabs.get(tab.id); } catch (e) { break; }
  }

  // Inject the page helper and run the command. Retry a few times: right after a
  // page loads the helper may not be in place yet, or an SPA may still be
  // settling, which shows up as "page helper not loaded".
  let last = { ok: false, error: "page helper not loaded" };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["page_actions.js"] });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (cmd) => {
          const a = globalThis.__easyAgent;
          if (!a) return { ok: false, error: "page helper not loaded" };
          if (cmd.action === "fill") return a.fill(cmd.field, cmd.value);
          if (cmd.action === "choose") return a.choose(cmd.field, cmd.value);
          if (cmd.action === "click") return a.click(cmd.text);
          if (cmd.action === "read_fields") return a.readFields();
          if (cmd.action === "read_page") return a.readPage();
          return { ok: false, error: "unknown action: " + cmd.action };
        },
        args: [command],
      });
      if (command.action === "read_fields") {
        const merged = [];
        for (const r of results) if (Array.isArray(r.result)) merged.push(...r.result);
        log("read_fields: " + merged.length + " field(s) across " + results.length + " frame(s)");
        if (merged.length > 0) return merged;
        last = [];   // empty; let it retry in case the page is still rendering
        continue;
      }
      if (command.action === "read_page") {
        const fields = [];
        const clickables = [];
        for (const r of results) {
          const o = r.result;
          if (o && typeof o === "object") {
            if (Array.isArray(o.fields)) fields.push(...o.fields);
            if (Array.isArray(o.clickables)) clickables.push(...o.clickables);
          }
        }
        log("read_page: " + fields.length + " fields, " + clickables.length + " clickables");
        if (fields.length || clickables.length) return { fields, clickables };
        last = { fields: [], clickables: [] };
        continue;
      }
      let firstError = null;
      for (const r of results) {
        if (r.result && r.result.ok) return r.result;
        if (!firstError && r.result && r.result.error) firstError = r.result;
      }
      last = firstError || { ok: false, error: "no frame could do that" };
      // Only a "helper not loaded" is worth retrying; a real "not found" is final.
      if (!/helper not loaded/.test(last.error || "")) return last;
      log("attempt " + (attempt + 1) + ": " + last.error + " - retrying");
    } catch (e) {
      last = { ok: false, error: String(e) + " (on " + (url.split("?")[0] || "this tab") + ")" };
      log("runOnTab error: " + last.error);
    }
  }
  return last;
}

// Stay connected to the agent bridge so the terminal can reach the browser.
function connect() {
  if (port) { log("connect() skipped: already connected"); return; }
  log("connect(): opening native port to " + HOST);
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    log("connectNative threw: " + e + " — retrying in 5s");
    setTimeout(connect, 5000);   // agent not installed yet; try again later
    return;
  }
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "keepalive") { log("keepalive from bridge"); return; }
    if (msg.type === "command") {
      log("command #" + msg.id + " action=" + msg.action);
      const result = await runOnTab(msg, null);   // the front tab (your form)
      if (port) port.postMessage({ type: "result", id: msg.id, result });
    }
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;          // handled: no console warning
    log("port disconnected" + (err ? (": " + err.message) : "") + " — reconnect in 3s");
    port = null;
    setTimeout(connect, 3000);                     // bridge closed; reconnect
  });
  log("connect(): port opened");
}
connect();

// Reconnect when Chrome starts or the extension (re)loads, so the bridge comes
// back up without needing the popup.
chrome.runtime.onStartup.addListener(() => { if (!port) connect(); });
chrome.runtime.onInstalled.addListener(() => { if (!port) connect(); });

// Self-healing safety net. Chrome shuts down idle MV3 service workers, which
// drops the bridge; a plain setTimeout cannot revive a worker that is already
// being torn down. An alarm, however, wakes a sleeping worker on schedule, so
// we reconnect automatically without a manual extension reload. 30s (0.5 min)
// is Chrome's minimum alarm period.
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") { log("alarm fired; port=" + (port ? "up" : "down")); if (!port) connect(); }
});

// Manual popup helpers (Check agent / List fields) for debugging.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.from === "popup") {
    runOnTab(msg.command, msg.tabId).then(sendResponse);
    return true;
  }
});
