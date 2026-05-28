---
name: agentic-purchase-gate
description: Demo agentic checkout authorization. Use when the user expresses a purchase intent ("buy X for $Y", "purchase Z for $N", "I want to get a pair of shoes for $100") or explicitly asks to test the passkey gate. Drives the local helper at `spike/passkey-gate/` to open a browser, complete a real WebAuthn ceremony, and emit a mock AP2 Payment Mandate. This is the *gate* slice of the UCP Tester PRD (`docs/superpowers/specs/2026-05-27-ucp-tester-design.md`) — it does NOT yet drive a full UCP scenario via the `ucp` CLI. Only loadable when this repo's spike directory is present.
---

# Agentic purchase gate

You are the orchestration layer for an end-to-end demo of passkey-gated agentic checkout. The user types a purchase intent in natural language; you translate it into a real WebAuthn ceremony and return a structurally-AP2-shaped Payment Mandate. The cryptography is mocked but the user-authorization ceremony is real (Touch ID / Windows Hello / hardware key).

## When to use

Trigger on any of:

- "buy X for $Y" / "purchase X for $Y" / "I want to get X for $Y"
- "test the passkey gate" / "demo agentic checkout"
- Any request that pairs a noun-phrase item with a price.

Do NOT use for:

- Real payments. The signature is mock; no money moves.
- Full UCP-scenario testing. That's the broader P1 work and isn't built yet.
- Multi-line-item carts. The current helper supports a single line item.

## Procedure

The helper script `run.sh` lives at `../../spike/passkey-gate/` relative to this SKILL.md. When the skill is loaded (either via an installed plugin or running `claude` in the plugin repo), Claude Code's bash invocation cwd is set to the skill's own directory, so the relative path resolves correctly. Because the whole repo is the plugin (`marketplace.json` `source: "./"`), `spike/` is copied into the plugin cache alongside the skill, so the relative path still resolves post-install.

**1. Parse the user's intent.**

- *Item*: a concise noun phrase, e.g. `"Brooks Ghost 17 running shoes"`, `"flat white"`, `"hardcover book"`. Keep it descriptive but short — it renders in the cart receipt.
- *Price*: a positive number. Strip `$`, `,`, currency words. Reject non-positive values.
- *Currency*: `USD` unless the user specifies (e.g. `€`, `£`, `EUR`, `GBP`). Pass `--currency <CODE>` only if non-default.

**2. Invoke the helper.**

```bash
../../spike/passkey-gate/run.sh --item "<ITEM>" --price <PRICE>
```

Use the Bash tool, foreground (NOT background), with timeout >= 180000ms. The helper itself has a 120s internal timeout for the user's Touch ID gesture; bash needs headroom beyond that. Before invoking, tell the user one short line like *"On it. Building the cart and opening the passkey gate."* so they know the browser is about to pop.

If the relative path resolves to a "no such file" error, fall back to discovering the plugin root: `find ~/.claude/plugins -name "run.sh" -path "*ucp-agentic-tester*passkey-gate*" -print -quit` returns the absolute path; invoke that directly.

**3. Wait for the helper to exit.**

The helper prints to the terminal:

- stderr lines starting with `[spike]` (startup / browser-opening notices).
- A `═══════` banner (3 lines) with a summary, also stderr.
- The full Payment Mandate JSON on stdout.

Exit codes:

- `0` — ceremony succeeded; JSON is valid; parse it.
- `124` — internal helper timeout (user didn't complete Touch ID in 120s). Offer to re-run.
- `2`–`5` — adapter validation failed; surface the helper's stderr.
- Anything else — investigate; show the user the helper output.

**4. Validate four gates against the mandate.** Surface results as four ✓/✗ lines.

| Gate | Check |
|---|---|
| Totals | sum of `cart.lineItems[*].lineTotal` + `cart.totals.tax` + `cart.totals.shipping` == `cart.totals.total` == `payment.amount` |
| Authorization | `userAuthorization.verified` AND `userAuthorization.userVerified` AND `userAuthorization.hardwareBacked` all true |
| Expiry | now < `expiresAt` (UTC) |
| Subject binding | `subject.credentialID` == `userAuthorization.credentialID` |

If any gate fails, surface *which one* and the offending field values, and do not claim authorization succeeded.

**5. Report concisely.** Match this template — short, video-friendly, no exposition:

```
**Authorized.** `<mandate.id>` · $<total> <currency> captured for <item description>.

- **Totals:** `<line>+<tax> tax+<ship> ship → <total>` matches `payment.amount` ✓
- **Authorization:** `userVerified=true · hardwareBacked=true · verified=true` ✓
- **Expiry:** issued `<iso>`, valid until `<iso>` (5 min window) ✓
- **Subject binding:** `subject.credentialID` matches `userAuthorization.credentialID` (`<id>`) ✓

Skill would now call `merchant.checkoutComplete(mandate)` and continue to `order.get`.
```

## Scope and honesty

When asked what's real vs. mocked, be precise:

- **Real**: the WebAuthn ceremony, hardware-backed user verification, the assertion signature check on the server side, the mandate's structural shape.
- **Mock**: the mandate signature (`MOCK-DEV-SIGNER` = sha256 of body), the payment instrument reference, the merchant, the cart catalog. No money moves. No real merchant is contacted.

The PRD at `docs/superpowers/specs/2026-05-27-ucp-tester-design.md` is the authoritative scope statement. This skill demonstrates the *passkey-gated authorization* step of Phase 1, not the full UCP Tester.

## Setup notes for first-time users

- The helper's `run.sh` runs `npm install` automatically on first invocation if `node_modules` is missing. The user may see a short pause.
- The helper picks a random `localhost` port each run; not a bug.
- The helper opens the user's *default* browser via `open`. On macOS, Safari and Chrome both work; if a user reports issues, suggest Chrome.
- Each ceremony registers a *fresh* passkey (the spike is intentionally stateless). Production would persist the credential per merchant.

## Failure-mode playbook

| Symptom | Likely cause | Action |
|---|---|---|
| Exit 124 | User didn't touch sensor in 120s | Offer to re-run; mention the 2-min window |
| Browser didn't open | `open` failed or default browser not set | Tell user the URL printed in `[spike]` stderr; ask them to navigate manually |
| 404s in browser console for `/lib/sw/...` | `node_modules` not installed | Run `cd spike/passkey-gate && npm install` then retry |
| Mandate JSON missing some field | Helper version mismatch | Read the actual stdout and show the user; do not fabricate fields |

## What this skill is NOT

- Not a payment processor.
- Not a credential issuer.
- Not the full UCP Tester (that builds on this).
- Not safe for production use with real money or real merchant endpoints.
