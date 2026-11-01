// Background service worker: the bridge between the easy-agent (a C++ program
// on your computer) and the current web page.
//
// Chrome connects to the agent through NATIVE MESSAGING: a private pipe between
// Chrome and the program, started by Chrome. No network port is opened.
//
// The agent sends commands like {action:"fill", field:"Email", value:"..."}.
// We run them on the active tab via chrome.scripting and send the result back.

const HOST = "com.makeiteasy.easy_agent";   // must match the native host manifest

// Runs one command on the active tab. Returns the page's {ok,error,...}.
async function runOnActiveTab(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false, error: "no active tab" };

  try {
    // 1. Inject page_actions.js, which defines globalThis.__easyAgent on the page.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page_actions.js"] });
    // 2. Call the right function with the command.
    const [out] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
    return out.result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// --- native messaging: talk to the easy-agent ---
let port = null;

function connectAgent() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    console.warn("easy-agent native host not available:", e);
    port = null;
    return;
  }
  port.onMessage.addListener(async (command) => {
    const result = await runOnActiveTab(command);
    if (port) port.postMessage({ id: command.id, ...result });
  });
  port.onDisconnect.addListener(() => { port = null; });
}

// The popup also uses runOnActiveTab directly (for manual testing without the
// agent). This relays popup messages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.from === "popup") {
    runOnActiveTab(msg.command).then(sendResponse);
    return true;   // async response
  }
});

connectAgent();
