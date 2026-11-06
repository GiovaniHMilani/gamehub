---
name: electron-security
description: Security review and secure implementation for GameHub Electron features. Use for IPC, preload, remote content, navigation, sessions, permissions, credentials, WebContentsView, CSP, external links, and Electron attack surfaces.
---

# Electron Security

## Threat model
Assume embedded game pages and all remote content are untrusted.

The security goal is to prevent remote content from gaining:
- Node.js access
- filesystem access
- arbitrary IPC capabilities
- unrestricted navigation control
- access to another account's browser session
- access to GameHub's privileged APIs

## Mandatory Electron baseline
Prefer:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
}
```

Use sandboxing where compatible with the application's required Electron architecture.

Never enable Node integration merely to make a feature easier.

## Preload boundary
Expose a capability-oriented API:

```ts
contextBridge.exposeInMainWorld("gameHub", {
  instances: {
    list: () => ipcRenderer.invoke("instances:list"),
    create: (input) => ipcRenderer.invoke("instances:create", input),
  },
})
```

Do not expose:

```ts
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer,
  shell,
  fs,
})
```

Do not expose arbitrary `send`, `invoke`, or channel selection controlled by remote page input.

## IPC validation
Every Main-side IPC handler must:
1. validate the sender/context when meaningful
2. validate input
3. enforce allowed operations
4. avoid passing privileged objects to untrusted callers
5. return predictable errors

Never concatenate user/remote input into filesystem commands, shell commands, SQL, or unrestricted URLs.

## Navigation security
Implement explicit policies for:
- `will-navigate`
- `setWindowOpenHandler`
- popup creation
- redirects
- downloads
- external links

A remote page must not be able to navigate the application's primary shell to an arbitrary local file or privileged URL.

## Session isolation
Each account instance must have a unique persistent partition.

Example:

```text
persist:gamehub-instance-a
persist:gamehub-instance-b
persist:gamehub-instance-c
```

Never accidentally reuse another instance's partition.

Treat partition identifiers as internal application identifiers. Do not derive them directly from untrusted URLs or arbitrary user strings without normalization.

## Credentials and authentication
Do not read or export cookies from the renderer unless there is an explicit, reviewed product requirement.

Prefer letting Chromium/Electron manage authentication state inside the persistent session.

Do not log:
- cookies
- authorization headers
- session tokens
- passwords
- OAuth tokens
- sensitive localStorage values

Redact sensitive values from diagnostics.

## Remote content
Remote game pages can contain malicious or compromised scripts.

Avoid injecting privileged JavaScript into remote pages.

Do not expose secrets through:
- query strings
- DOM
- global variables
- preload objects
- custom HTTP headers unless strictly required

## CSP
Where the application shell is under GameHub's control, use an appropriate Content Security Policy.

Do not weaken CSP globally just to silence a development error.

## External browser
Use an explicit external-browser path for links that should leave GameHub.

Do not automatically embed arbitrary external URLs.

## Permissions
Grant only required permissions. Review:
- notifications
- clipboard
- media
- geolocation
- camera/microphone
- downloads

Do not create a blanket allow-all permission handler.

## Dangerous patterns
Reject or flag:
- `nodeIntegration: true` for remote content
- `contextIsolation: false`
- unrestricted `ipcRenderer`
- arbitrary `executeJavaScript` from renderer-controlled input
- arbitrary shell execution
- `eval` / `new Function`
- loading untrusted local HTML with privileged APIs
- `file://` navigation of untrusted data
- secrets in logs
- sharing persistent partitions between accounts

## Security review checklist
Before completion, ask:
- Can a remote page access Node?
- Can it invoke privileged IPC?
- Can it navigate the shell?
- Can it open arbitrary windows?
- Can one account access another account's cookies/storage?
- Are credentials logged or exposed?
- Are permissions explicit?
- Are external URLs controlled?
- Does the feature weaken isolation?

Never bypass a game's authentication, anti-bot, access-control, or security mechanisms.
