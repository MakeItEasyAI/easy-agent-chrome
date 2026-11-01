// Background service worker: the bridge between the easy-agent (a C++ program
// on your computer) and the current web page.
//
// Chrome connects to the agent through NATIVE MESSAGING: a private pipe between
// Chrome and the program, started by Chrome. No network port is opened.
//
// Two paths:
//   - Manual (popup Fill / List fields): runs one action on the page directly.
//   - Task  (popup "Fill form from resume"): starts the agent, which reads the
//     form, matches your resume, and sends fill commands back. We run each on
//     the page and relay the agent's progress to the popup.

const HOST = "com.makeiteasy.easy_agent";

// Runs one {action,...} command on the active tab. Returns the page result.
async function runOnActiveTab(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false, error: "no active tab" };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page_actions.js"] });
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

// Manual popup actions (Fill / List fields): one-shot, no agent.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.from === "popup") {
    runOnActiveTab(msg.command).then(sendResponse);
    return true;   // async response
  }
});

// Task flow: the popup opens a port named "task" and sends { task, resume }.
// We start the agent, relay its fill commands to the page, and stream its
// log/done messages back to the popup. The agent is closed when the task ends.
chrome.runtime.onConnect.addListener((popupPort) => {
  if (popupPort.name !== "task") return;

  let host = null;
  popupPort.onMessage.addListener((msg) => {
    if (msg.type !== "task") return;
    try {
      host = chrome.runtime.connectNative(HOST);
    } catch (e) {
      popupPort.postMessage({ type: "done", ok: false, message: "agent not reachable: " + e });
      return;
    }
    host.onMessage.addListener(async (fromAgent) => {
      if (fromAgent.type === "command") {
        const result = await runOnActiveTab(fromAgent);
        host.postMessage({ type: "result", id: fromAgent.id, result });
      } else {
        popupPort.postMessage(fromAgent);                  // log / done / error
        if (fromAgent.type === "done" && host) { host.disconnect(); host = null; }
      }
    });
    host.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;                       // handled: no console warning
      if (host) popupPort.postMessage({ type: "done", ok: false, message: "agent disconnected" });
      host = null;
    });
    host.postMessage({ type: "task", task: msg.task, resume: msg.resume || "" });
  });

  popupPort.onDisconnect.addListener(() => { if (host) { host.disconnect(); host = null; } });
});
