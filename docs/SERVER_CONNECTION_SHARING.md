# Server connection sharing

Settings → Server provides explicit actions on each saved server, including
inactive or offline profiles:

- Preview the first four characters of a saved token with a masked suffix, then
  copy the full token with the button at the end of its row. Short tokens stay
  fully masked.
- Display a locally generated connection QR code and save it as a PNG.

Single-address QR sharing works with older servers. Multi-address sharing from a
remote desktop uses the authenticated native `GET /api/connection-addresses`
endpoint on an updated server. Offline/older servers retain single-address QR
sharing. Token copying reads the
selected profile's credential in the desktop main process and returns no token
to the renderer. Expanding a card separately requests an asynchronous preview,
masked in the main process before IPC; collapsed cards do not read credentials.
The preview is discarded on collapse and refreshed after token edits. It is not
persisted or logged. Normal profile listing still exposes only credential presence.
QR pixels themselves contain the credential, remain in the open component's
memory, and are not written to settings, analytics or logs. Saving is an explicit
native file-picker action. Credential changes invalidate pending reads and
saved-image requests. A stored token may no longer be valid on the server;
copying it does not reauthenticate or rotate it.

The code contains the saved URL plus server-advertised LAN/Tailscale addresses
when available. Discovery happens only when sharing, never on health polling.
The desktop does not substitute its own interface addresses. A saved identity
mismatch prevents sharing. Loopback and wildcard addresses produce an
explicit local-only warning. Users need a phone-reachable address and a server
that listens on that address; generating a QR does not change network binding,
firewall rules or Tailscale membership. This grants the access of the existing
operator token, rather than read-only access to an individual chat.

## Retained connection payload

The payload is `agentsdock://connect#` followed by URL-encoded fragment fields:

| Field | Meaning |
| --- | --- |
| `v` | Required format version: `1` for a single address, `2` for multiple candidates |
| `url` | Version 1 HTTP(S) server URL, without URL credentials, query or fragment |
| `urls` | Version 2 JSON array of one to six explicit HTTP(S) addresses; replaces `url` |
| `token` | Saved server access token |
| `name` | Suggested display name |
| `identity` | Expected durable server identity; required for version 2 |

The serializer and strict parser are in
`electron/src/shared/server-connection-link.ts`. Special characters and Unicode
must round-trip through URL encoding. Reject unsupported versions, duplicate or
unknown fields, empty tokens and oversized payloads. The size limit is 1,800
UTF-8 bytes for the complete link. Treat the whole link and QR image as secrets.

Mobile **Servers > Add Server** shows **Scan QR code**, followed by a subtle
**or add manually** caption and all three manual steps without an extra tap.
Scanning uses a square camera
viewport and shows where to obtain the code. A successful decode shows a compact
name/address review, not the manual form; **Edit details** reveals the masked
fields when corrections are needed. Scanning tests authenticated health, including the QR's
expected identity when supplied. **Add** saves and switches only after success;
canceling or dismissing does not save anything. Manual entry remains available.
For v2, the phone starts with the preferred address and staggers alternatives
by 200 ms. Each probe has a five-second limit; the first authenticated identity
match wins and remaining probes are canceled. Only an all-address failure shows
an error. Saving retains the candidate list and identity with the existing
profile, while the token remains in SecureStore. Reconnect prefers the last
working address and can switch routes without changing chat/cache ownership.
Rescanning a saved identity updates its addresses only after **Use**, revalidating
the saved credential without silently replacing it. Editing an address manually
or resetting the identity clears the old alternate list.
QR-image import and connection deep links remain disabled. Tokens stay masked in
the editor and are persisted through the existing SecureStore flow. The camera
unmounts when the scanner closes or the app enters the background. Native camera
permission requires a rebuilt app, not just a JavaScript update.

## CLI

One interactive command shows the selected instance's available URLs, its token,
and a terminal QR together:

```sh
agentsdock token work
```

Omit `work` to select an instance interactively. From an uninstalled source
checkout, the equivalent is `./server/instances.sh token work` at the repository
root. This requires the updated local helpers, not a new server HTTP endpoint.
Redirected token output intentionally remains token-only for scripts. Keep the
whole terminal screen private; do not paste it into support reports.

Interactive installation and token display now try to render a connection QR
locally after setup. The npm postinstall path writes credential-bearing output
only to `/dev/tty`, never captured lifecycle stdout/stderr. Headless installation
does not generate a QR. QR failure is nonfatal and suggests the explicit pairing
command; it never silently substitutes a localhost address for a phone address.

```sh
agentsdock pair                 # default instance, include Tailscale and LAN
agentsdock pair work
agentsdock pair work --network lan
agentsdock pair work --output connection.png
agentsdock pair work --link      # explicitly print the secret connection URL
agentsdock qrcode work           # alias
```

The command reads only the selected OS user's managed instance configuration,
reuses the instance manager's binding-aware address discovery, and authenticates
health at discovered addresses before encoding their common identity and token.
Unreachable addresses are omitted; conflicting identities fail closed. It prints
the included addresses, sharing guidance and a terminal QR; `--output` instead saves a PNG
with owner-only permissions and refuses to overwrite an existing file. The QR
renderer is bundled with its third-party notices, preserving offline npm installs
and the exact single runtime dependency. Regenerate it with
`node scripts/build_cli_qr.mjs` after installing the locked desktop dependencies.

Automatic mode includes up to six binding-aware, authenticated candidates.
`--url http://192.168.1.20:7851` restricts the QR to one listed address; arbitrary
URLs are rejected. More than six candidates requires an explicit selection.

`--network auto` is the default. `tailscale`, `lan`, and `local` choose a specific
network. Auto never falls back to localhost. `--network local` explicitly enables
same-computer/iOS-simulator testing and warns that a physical phone cannot use it.
A phone must share a reachable LAN or private Tailscale network; pairing does not
change the server bind, firewall, or Tailscale policy and does not start/restart a
service. This feature is available only in a package containing these changes;
it is not added to already-published npm versions.

## Network coverage

Where the QR is displayed does not determine where the server runs. A connected
desktop shares the selected profile's credential and server-provided addresses,
never the desktop computer's own LAN/Tailscale address. The phone must reach at
least one included address.

| Situation | Address to encode | Prerequisites / limits |
| --- | --- | --- |
| Phone and server on the same Wi-Fi/LAN | Server LAN address | Server bound to that interface or an appropriate wildcard; local-network permission, firewall and Wi-Fi client isolation must allow access. |
| Phone away from server, both on Tailscale | Server Tailscale address or reachable tailnet DNS name | Tailscale connected on the phone and server, device sharing/tailnet access policy allows the service port. Same Wi-Fi is unnecessary. |
| Same Wi-Fi and both also on Tailscale | Prefer the Tailscale address for roaming | Tailscale can use a direct local route; keeping its address avoids changing the saved profile when leaving Wi-Fi. |
| QR shown by a different connected desktop | That desktop profile's server URL | The phone needs its own route and access permission to the server. Connectivity from the desktop alone is not proof of phone reachability. |
| Desktop uses localhost or an SSH port-forward | Do not reuse the local-only URL on a phone | Generate a LAN/Tailscale QR on the actual server, or configure a deliberately phone-reachable endpoint. |
| Public/reverse-proxied server | Configured HTTPS endpoint | Valid certificate, authenticated API and WebSocket forwarding. Do not automatically publish the operator service or enable a public tunnel. |
| Neither a reachable LAN, tailnet nor configured remote endpoint | No valid phone connection yet | A QR cannot create a network route or bypass firewall/authentication restrictions. |

Format v1 still contains one URL and remains supported. Format v2 carries the
explicit alternatives needed for automatic selection and later reconnect.
Existing single-address profiles need a new QR to learn their alternatives;
clients never guess host addresses. Old mobile versions reject v2 rather than
partially importing it. If all routes fail, the saved profile is retained and
the phone offers its existing retry flow. QR sharing does not change network
binding, firewalls, Tailscale login or ACLs, and cannot make an unreachable host
reachable. DHCP address changes require a refreshed QR unless another included
route remains reachable.

References: [Tailscale device connectivity](https://tailscale.com/docs/how-to/connect-to-devices),
[connection types](https://tailscale.com/docs/reference/connection-types),
and [Serve versus public access](https://tailscale.com/docs/features/tailscale-serve).

## Acceptance

Current multi-address iteration: actual offscreen desktop UI generates v2 from
an authenticated test server's LAN/Tailscale discovery. An independently decoded
QR is injected at the installed iOS scanner callback, then saved via an actual
Add tap. Real transport reaches the test server on both routes; test-only fetch
faults verify fallback in both directions, all-route failure and recovery without
duplicate profiles. All fault injection and temporary profiles are removed.
This is not a physical camera scan or an off-Wi-Fi phone test. Desktop/native
transport, mobile/store, CLI and server checks plus production builds pass.

Earlier scanner iteration: a rebuilt camera-enabled iOS simulator exercises the
choice/manual/scan navigation and verifies a 360-by-360 native preview. Injecting
an independently decoded QR into that actual app verifies authenticated health,
identity checking, compact confirmation, real Add interaction and saved profile
activation against a real test server. The test profile is removed afterward.
An actual PTY token-command run shows URLs/token/QR together. Focused mobile,
CLI and binding tests and iOS/Android production exports pass. Physical camera
capture, an off-Wi-Fi phone over Tailscale and Android device UI remain pending.

### Earlier verification

- Focused desktop service, IPC, preload, QR contract and component checks cover
  profile targeting, unchanged active selection, credential changes, rejected
  untrusted callers, missing credentials, save cancellation and stale saves.
- Native offscreen desktop interaction verified the copy action with the real
  macOS clipboard and authenticated health on a local test server, and verified
  displaying the QR plus the local-only warning.
- An independent macOS Vision decode of an image produced by the shared encoder
  recovered the expected URL/token and authenticated to that same test server.
  Automated service tests verify the saved PNG bytes with a mocked destination
  picker. This is not a mobile scan test.
- The computer-control policy blocked interacting with Electron's native save
  picker. Completing that picker, visual acceptance across both themes/narrow
  layouts, and real mobile import remain pending; do not report full acceptance.

Manual desktop check: copy tokens from two different profiles without switching
servers, confirm the matching credentials, open/close the QR, save/cancel the PNG
picker, reopen the app, and repeat. Use disposable connection profiles and keep
token-bearing screenshots and PNGs out of public reports.


Prior CLI/mobile verification (before mobile QR removal):

The older import/deep-link fixtures described below were removed. Current camera
fixtures cover duplicate scan events, permission denial, backgrounding, retry,
cancel, authenticated identity mismatch, and manual connection regression. Native
modules are mocked in these fixtures; they do not establish real camera capture.

- Packaged runtime + short CLI installed offline with lifecycle scripts disabled.
  The installed CLI rejected automatic localhost pairing; explicit local pairing
  generated a PNG whose independent Vision decode authenticated to the intended
  test server with the exact expected identity. No service restart was needed.
- CLI/package/instance tests cover address choice, omitted/invalid selectors,
  private output, failed authentication, symlink rejection, immutable PNG output,
  offline packaging and unchanged installation/lifecycle behavior.
- Mobile contract and component fixtures cover all three encoders, confirmation
  before network access, duplicate taps, QR image import, authentication failure,
  identity mismatch, cancellation and reuse of saved identities. Existing profile
  and setup checks also pass. Component native modules are mocked in these tests.
- Simulator UI operation is blocked by the computer-control policy. Actual app
  scanning/import, native SecureStore persistence across reopen, theme/layout,
  cold/warm deep-link presentation, and a physical phone over LAN/Tailscale remain
  manual acceptance requirements. Build success alone does not close those gaps.
- The iOS simulator Release build passed with camera permission and both URL
  schemes verified in the actual bundle. It was installed into an isolated
  simulator with a QR image fixture; it has not been launched or driven.
