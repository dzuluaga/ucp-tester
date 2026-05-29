# UCP Tester

**An open, self-serve way to build and test agentic-commerce (UCP) merchant integrations end-to-end — no partner pipeline required.**

When an AI agent buys something on your behalf, *who authorizes the payment?* This repo answers that with a real authorization gate: state a purchase intent in plain English, approve it on hardware you already own, and get back a structurally-AP2 Payment Mandate — validated against four gates.

It ships as a Claude Code plugin, and offers **two authorization modalities** through the same skill and intent parser:

- **Passkey gate** — a WebAuthn ceremony on the same device (Touch ID / Windows Hello / a hardware key). The ceremony is real; the mandate signature is a dev mock.
- **DC payment gate** — a Digital Payment Credential (DPC) presented cross-device over the W3C [Digital Credentials API](https://www.w3.org/TR/digital-credentials/): scan a QR with your wallet, confirm the amount, and the wallet **cryptographically signs over the exact amount and payee**. That amount binding is real.

## Demo

[![Watch the end-to-end demo](https://img.youtube.com/vi/qE_BsghAs98/maxresdefault.jpg)](https://youtu.be/qE_BsghAs98)

*Touch ID for AI agents — a passkey-gated checkout, end to end.*

## Quickstart

In [Claude Code](https://claude.com/claude-code):

```
/plugin marketplace add dzuluaga/ucp-tester
/plugin install ucp-agentic-tester@ucp-tester
buy a flat white for $5
```

Your browser opens, you complete the passkey ceremony, and the Payment Mandate appears in both the browser receipt card and the terminal. Claude then reports four gates: **totals balance**, **hardware-backed user verification**, **expiry window**, and **subject binding**.

To run the **DC payment gate** instead, add a digital-credential phrase to the intent:

```
buy a flat white for $5 using the payment credential
```

A desktop QR opens; scan it with your wallet (Multipaz, today), confirm the amount and payee, and approve. The wallet signs over that amount, and Claude reports the gates — including the load-bearing **amount binding**.

> First run does a one-time `npm install` in the plugin cache (brief pause). Passkey gate works on macOS Touch ID today; Windows Hello / Android over Wi-Fi are spot-checks in progress. DC payment gate needs desktop Chrome 141+ (`chrome://flags#web-identity-digital-credentials`) and a DPC provisioned in your wallet.

## What's real vs. mocked

**Passkey gate:**

| ✅ Real | 🧪 Mocked |
|---|---|
| The WebAuthn passkey ceremony | The mandate signature (a dev signer, not production crypto) |
| Hardware-backed user verification | The payment instrument reference |
| Server-side verification of the signed assertion | The merchant and cart catalog |
| The Payment Mandate's structural shape | **No money moves. No real merchant is contacted.** |

**DC payment gate:**

| ✅ Real | 🧪 Mocked |
|---|---|
| The wallet presentation of the DPC over the Digital Credentials API | Issuer / ASPSP **trust** verification (self-signed reader cert, advisory trust) |
| The wallet's signature over the **exact amount + payee** (`transaction_data_hash`) | The merchant and cart catalog |
| The disclosed instrument fields (issuer, masked account, holder, expiry) | **No money moves. No real merchant or ASPSP is contacted.** |
| The four gate checks (incl. independent amount-binding re-derivation) | |

The key difference: the passkey gate mocks the mandate signature, while the DC payment gate carries a **real wallet-signed authorization over the amount** — only the issuer/ASPSP trust check is mocked.

## What you'll see

An `ap2.PaymentMandate` plus a four-gate report. The gates differ slightly per modality:

**Passkey gate** — `userAuthorization` embeds the verified WebAuthn assertion:

- **Totals** — line items + tax + shipping equal the total and the charged amount
- **Authorization** — `verified` + `userVerified` + `hardwareBacked` all true
- **Expiry** — the mandate is still inside its validity window
- **Subject binding** — the mandate subject matches the credential that signed it

**DC payment gate** — `userAuthorization` carries the wallet-signed `transaction_data_hash`:

- **Amount binding** — `SHA-256(transactionData)` equals the hash signed in the wallet's response, **and** the signed amount/payee match the cart (re-derived independently, not trusting the helper)
- **Authorization present** — the presentation decodes to a DeviceResponse with `issuerAuth` + `deviceAuth`
- **Credential not expired** — the disclosed `expiry_date` is in the future
- **Subject binding** — the mandate subject matches the disclosed payment-instrument id

## How it works

Two tiny local helpers, one per modality, each spawning an ephemeral `localhost` web server and emitting the mandate on stdout. Claude (via the `agentic-purchase-gate` skill) parses your intent, routes to the right helper, and validates the gates. No MCP server, no production credential stack — just web standards and hardware you already have.

- **`spike/passkey-gate/`** — opens a gate page that runs `navigator.credentials.get({publicKey})` (WebAuthn), verifies the returned assertion server-side.
- **`spike/dc-payment-gate/`** — binds the cart's amount + payee as OpenID4VP `transaction_data`, serves a cross-device QR page that runs `navigator.credentials.get({digital})`, then decrypts the wallet's response and verifies the signed hash. A separate `validate.js` independently re-checks the four gates. Built on the proven Path A harness in `spike/dc-gate-probe/`.

## Going deeper

- **PRD / design:** [`docs/superpowers/specs/2026-05-27-ucp-tester-design.md`](docs/superpowers/specs/2026-05-27-ucp-tester-design.md) — the vision, architecture, roadmap, and the demo modalities we're planning to showcase.
- **DC payment gate design:** [`docs/superpowers/specs/2026-05-28-dc-payment-gate-design.md`](docs/superpowers/specs/2026-05-28-dc-payment-gate-design.md) — the wallet-signed amount-binding approach and the four gates.
- **Spike findings:** [`spike/passkey-gate/FINDINGS.md`](spike/passkey-gate/FINDINGS.md) and [`spike/dc-payment-gate/FINDINGS.md`](spike/dc-payment-gate/FINDINGS.md) — what was validated, the wrinkles, and what's still open.
- **The skill:** [`skills/agentic-purchase-gate/SKILL.md`](skills/agentic-purchase-gate/SKILL.md) — the orchestration contract for both modalities.

## Scope

This is the *agentic authorization* slice of a larger vision (Postman/Cypress for agentic commerce). It is **not** a payment processor, a credential issuer, or the full UCP test runner yet — see the PRD for the roadmap. Not for use with real money or real merchant endpoints.

## License

MIT — see [LICENSE](LICENSE).
