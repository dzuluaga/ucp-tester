# Passkey Gate Spike — Findings

**Spike:** Phase 0 of the [UCP Tester PRD](../../docs/superpowers/specs/2026-05-27-ucp-tester-design.md).
**Date:** 2026-05-27
**Question:** Can a Claude skill drive a real WebAuthn ceremony end-to-end via a local helper, on macOS Touch ID and on a CI virtual authenticator, and receive a verified assertion back?

## Status

| Exit criterion | Status | Evidence |
|---|---|---|
| macOS Touch ID round-trip | ✅ passed | Verified assertion below; reproduced across 6+ runs |
| Mock AP2 Payment Mandate emitted from verified assertion | ✅ passed | `mock-ap2-adapter.js` + `mandate-wrapper.js`; shape matches AP2 expectations |
| Browser and terminal show the *same* canonical mandate | ✅ passed | Single mandate per ceremony rendered in both panes (same `mandate.id`) |
| Natural-language intent → parameterized cart → mandate | ✅ passed | "Brooks Ghost 17 for $100" via Claude → $108.25 mandate, item correctly threaded |
| Claude skill packages the flow for any cloner | ✅ shipped | `.claude/skills/agentic-purchase-gate.md` |
| CI virtual-authenticator path | ⏳ not yet attempted | — |
| Spot-check (Windows Hello *or* Android over Wi-Fi) | ⏳ not yet attempted | — |

## macOS Touch ID — verified assertion

Helper exited 0 after the user completed registration + authentication ceremonies in Chrome. Final payload on stdout:

```json
{
  "verified": true,
  "authenticatorInfo": {
    "newCounter": 0,
    "credentialID": "c2UzM5S6wij4X8pXLr7IcA",
    "userVerified": true,
    "credentialDeviceType": "multiDevice",
    "credentialBackedUp": true,
    "origin": "http://localhost:54389",
    "rpID": "localhost"
  },
  "origin": "http://localhost:54389",
  "rpID": "localhost",
  "timestamp": "2026-05-27T23:32:03.637Z"
}
```

Notable: `userVerified: true` (real biometric gesture, not just user-presence); `credentialDeviceType: "multiDevice"` + `credentialBackedUp: true` (iCloud-Keychain-synced passkey, real-world roaming property).

## What this proves for the PRD

- **The skill → helper → browser → secure element → skill round trip works**, with real server-side signature verification (not just "browser said OK"). The end-to-end claim in the *How the gate is implemented (P1)* section of the PRD is no longer paper for at least the macOS surface.
- **The assertion shape is exactly what a payment adapter would consume.** Exit code + stdout JSON is a clean contract for Bash-tool invocation from a skill.
- **No MCP server was involved.** A skill with Bash access is sufficient for this gate, as the PRD claims.

## Wrinkles encountered + fixed

1. **CDN URL guess for `@simplewebauthn/browser` was wrong.** The npm package ships ESM (`esm/index.js`) and CJS (`script/index.js`) but no pre-built UMD bundle at the path I assumed on jsdelivr. **Fix:** added `@simplewebauthn/browser` as a dep and serve `node_modules/@simplewebauthn/browser/esm/` under `/lib/sw/` via `express.static`. The browser loads ESM natively from a same-origin path, no CDN dependency.
2. *(no other issues encountered for the macOS leg)*

## Open items before declaring Phase 0 complete

1. **CI virtual-authenticator path** — required exit criterion per PRD. Plan: drive the same `./run.sh` from a Playwright (or `puppeteer`) script that calls `WebAuthn.addVirtualAuthenticator` via CDP before navigating to `/gate.html`. The helper should not need to change.
2. **Spot-check (one other surface)** — Windows Hello (if a Windows box is reachable) or Android over Wi-Fi. The latter needs HTTPS with a trusted cert (mkcert or similar), which is itself a finding worth documenting because production deployments of this helper will have to handle TLS for non-localhost surfaces.
3. **Persistence design decision** — the spike is intentionally stateless (fresh register-then-auth every run). Production needs to persist `credential` across runs so the gate only prompts on first use per merchant. Out of scope for P0 but worth noting before P1.

## What's now in the repo for collaborators

- **Spike helper** (`spike/passkey-gate/`) — `./run.sh --item "<item>" --price <price>` opens a browser, runs WebAuthn, emits the mock Payment Mandate to stdout *and* to a receipt card in the browser.
- **Claude skill** (`.claude/skills/agentic-purchase-gate.md`) — encodes the orchestration pattern (parse intent → invoke helper → validate four gates → report). Auto-loads when Claude Code is run in this repo. Triggered by natural-language purchase intent.
- **PRD** (`docs/superpowers/specs/2026-05-27-ucp-tester-design.md`) — the framing, the architecture, the open questions, the call to collaborate.

To verify the end-to-end demo:

```sh
git clone <repo>
cd ucp-agentic-tester
claude  # opens Claude Code; the skill is auto-loaded
> buy a coffee for $5
```

The browser pops, you complete Touch ID, the Payment Mandate appears in both the browser receipt card and the terminal JSON, and Claude validates the four gates.

## Decision

Based on the macOS leg + the natural-language → parameterized-cart → mandate flow + the skill packaging, the *technical feasibility* of the passkey gate is no longer in doubt. The remaining P0 work (CI virtual authenticator + one spot-check) hardens the case rather than reopens it.

**Recommendation:** flip the "Passkey scope in P1" open question from *open* to *yes, ship the gate in P1*, conditional on the CI leg also passing.
