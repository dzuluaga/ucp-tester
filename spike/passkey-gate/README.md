# Passkey Gate Spike

**Phase 0 of the [UCP Tester PRD](../../docs/superpowers/specs/2026-05-27-ucp-tester-design.md).**

Question this spike answers: *can a Claude skill drive a real WebAuthn ceremony end-to-end via a local helper, on macOS Touch ID and on a CI virtual authenticator, and receive a verified assertion back?*

If yes → the passkey-gated payment-adapter design in the PRD is real. The gate ships in Phase 1.
If no → the gate slips to P1.5, and we need a different mechanism.

## What this is

A throwaway helper. Express + `@simplewebauthn/server` on the backend, `@simplewebauthn/browser` on the page. Each run:

1. Starts an ephemeral local server on a random port (`127.0.0.1`).
2. Opens the default browser to `/gate.html`.
3. Runs a full WebAuthn registration + authentication ceremony against the platform authenticator.
4. Verifies the assertion server-side (real signature check, not just "browser said OK").
5. Prints the verified result as JSON to stdout and exits 0.

The helper is intentionally stateless — no DB, no persisted credentials, fresh register-then-auth every run. That's enough to prove the secure-element round trip.

## How to run (manual, with Touch ID)

```sh
cd spike/passkey-gate
./run.sh
```

A browser window opens. Click **Run passkey ceremony**, complete Touch ID twice (once for register, once for authenticate). The helper prints something like:

```json
{
  "verified": true,
  "authenticatorInfo": {
    "newCounter": 0,
    "credentialID": "…",
    "userVerified": true
  },
  "origin": "http://localhost:54321",
  "rpID": "localhost",
  "timestamp": "2026-05-27T20:14:51.123Z"
}
```

Exit 0. That's the success signal a skill would consume.

## How a skill would invoke it

```sh
ASSERTION_JSON=$(./spike/passkey-gate/run.sh)
echo "$ASSERTION_JSON" | jq -e '.verified == true' > /dev/null && echo "user verified, proceed"
```

The skill's Bash tool runs the script, captures stdout, parses the JSON, and uses `.verified` to gate the next step of a scenario. No MCP server required — pure local helper.

## Exit criteria (from the PRD)

- [ ] Assertion round-trips skill → browser → secure element → skill on **macOS Touch ID**.
- [ ] Same flow passes on the **CI virtual-authenticator path** (Chrome DevTools Protocol `WebAuthn.addVirtualAuthenticator`).
- [ ] Spot-check on at least one of: Windows Hello, or Android phone hitting the helper over Wi-Fi.

Findings get written to `FINDINGS.md` in this directory when the spike completes. That file + this code are the PRD's evidence trail.

## Things this spike does NOT prove (out of scope)

- Cross-host portability (Cursor / Copilot / Gemini). Skill-only validation is sufficient for the P0 decision.
- The right *language* for the production helper. Throwaway uses Node because `@simplewebauthn/*` is the lowest-friction WebAuthn lib; production may pick differently.
- Long-lived credential storage. Production needs the passkey to persist across runs; spike intentionally doesn't.

## Known fragility

- `origin` is `http://localhost:<random port>` per run. Passkeys are bound to `(rpID, credentialID)`, not the port — so re-runs work — but the random port means each spike run treats itself as fresh-context anyway.
- `RP_ID = "localhost"` only works for local. Mobile-over-Wi-Fi requires HTTPS with a valid cert (or `expo` / `mkcert`-style trust). The spot-check for mobile is *expected* to need extra setup; that's a finding, not a blocker.
