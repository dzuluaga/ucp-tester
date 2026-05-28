# UCP Tester

**An open, self-serve way to build and test agentic-commerce (UCP) merchant integrations end-to-end — no partner pipeline required.**

When an AI agent buys something on your behalf, *who authorizes the payment?* This repo's Phase 0 answers that with a real passkey gate: state a purchase intent in plain English, approve it with Touch ID (or Windows Hello / a hardware key), and get back a structurally-AP2 Payment Mandate — validated against four gates.

It ships as a Claude Code plugin.

## Quickstart

In [Claude Code](https://claude.com/claude-code):

```
/plugin marketplace add dzuluaga/ucp-tester
/plugin install ucp-agentic-tester@ucp-tester
buy a flat white for $5
```

Your browser opens, you complete the passkey ceremony, and the Payment Mandate appears in both the browser receipt card and the terminal. Claude then reports four gates: **totals balance**, **hardware-backed user verification**, **expiry window**, and **subject binding**.

> First run does a one-time `npm install` in the plugin cache (brief pause). Works on macOS Touch ID today; Windows Hello / Android over Wi-Fi are spot-checks in progress.

## What's real vs. mocked (Phase 0)

| ✅ Real | 🧪 Mocked |
|---|---|
| The WebAuthn passkey ceremony | The mandate signature (a dev signer, not production crypto) |
| Hardware-backed user verification | The payment instrument reference |
| Server-side verification of the signed assertion | The merchant and cart catalog |
| The Payment Mandate's structural shape | **No money moves. No real merchant is contacted.** |

The user-authorization ceremony is real from day one, with a clean promotion path to production credentials (DPC / Multipaz) later.

## What you'll see

A `ap2.PaymentMandate` whose `userAuthorization` embeds the verified WebAuthn assertion, plus a four-gate report:

- **Totals** — line items + tax + shipping equal the total and the charged amount
- **Authorization** — `verified` + `userVerified` + `hardwareBacked` all true
- **Expiry** — the mandate is still inside its validity window
- **Subject binding** — the mandate subject matches the credential that signed it

## How it works

A tiny local helper (`spike/passkey-gate/`) spawns an ephemeral `localhost` web server, opens the browser to a gate page that runs `navigator.credentials.get()`, verifies the returned assertion server-side, and emits the mandate. Claude (via the `agentic-purchase-gate` skill) parses your intent, invokes the helper, and validates the gates. No MCP server, no production credential stack — just web standards and hardware you already have.

## Going deeper

- **PRD / design:** [`docs/superpowers/specs/2026-05-27-ucp-tester-design.md`](docs/superpowers/specs/2026-05-27-ucp-tester-design.md) — the vision, architecture, roadmap, and the demo modalities we're planning to showcase.
- **Spike findings:** [`spike/passkey-gate/FINDINGS.md`](spike/passkey-gate/FINDINGS.md) — what was validated, the wrinkles, and what's still open.
- **The skill:** [`skills/agentic-purchase-gate/SKILL.md`](skills/agentic-purchase-gate/SKILL.md) — the orchestration contract.

## Scope

This is the *passkey-gated authorization* slice of a larger vision (Postman/Cypress for agentic commerce). It is **not** a payment processor, a credential issuer, or the full UCP test runner yet — see the PRD for the roadmap. Not for use with real money or real merchant endpoints.

## License

MIT — see [LICENSE](LICENSE).
