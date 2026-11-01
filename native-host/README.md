# Native messaging host

This connects the Chrome extension to the `easy` C++ agent. Chrome starts the
host program and talks to it over a private pipe (stdin/stdout) — **no network
port is opened**.

## Not wired up yet

The `easy` agent needs a "native host" mode that reads a message from stdin and
writes a reply to stdout (Chrome's native-messaging framing: a 4-byte little-
endian length, then the JSON). That mode will be added to the agent next.

## How it will install (macOS)

1. Build the agent and note the absolute path to the host binary.
2. Copy `com.makeiteasy.easy_agent.json.template` to
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.makeiteasy.easy_agent.json`
3. In that copy, set:
   - `path` to the absolute path of the host binary
   - the extension id in `allowed_origins` (shown on chrome://extensions after
     you load the extension)

Until the host exists, the extension still works for manual testing through its
popup (Fill / List fields).
