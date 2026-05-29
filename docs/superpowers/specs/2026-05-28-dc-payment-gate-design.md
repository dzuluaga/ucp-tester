# DC-payment-gate — design

**Date:** 2026-05-28
**Status:** design (approved sections 1–4; awaiting spec review)
**Sibling of:** `spike/passkey-gate/`
**Builds on:** `spike/dc-gate-probe/` (proven Path A harness)

## Goal

A localhost helper + skill that turns a natural-language purchase intent ("buy a
pair of headphones for $89 at Demo Merchant") into a **wallet-signed AP2 payment
mandate**, using the W3C Digital Credentials API cross-device "Path A" flow proven in
`dc-gate-probe`. Claude parses the intent, drives the Digital Payment Credential (DPC)
presentation, and orchestrates assembly + validation of the mandate.

No money moves. No real merchant or ASPSP is contacted. The reader cert is self-signed
(advisory trust). What is **real** is the wallet's cryptographic signature binding the
user's biometric consent to a specific amount and payee.

## What the v3 probe proved (the foundation)

Over Path A localhost, the Multipaz wallet:
- presents the DPC (`org.multipaz.payment.sca.1`, 6 disclosed fields), and
- signs a `transaction_data_hash` into the DeviceResponse's `deviceSigned` namespace
  `urn:eudi:sca:payment:1`, equal byte-for-byte to `SHA-256(transaction_data b64url string)`.

Verified: the signed hash matched our computed hash exactly. This is the missing piece
that elevates a bare card-field disclosure into a *payment authorization*. The Multipaz
app was **not modified** — DPC + `PaymentTransaction` (`urn:eudi:sca:payment:1`) are
already registered in the installed test build via `addUtopiaTypes()`.

## Key difference from passkey-gate

In passkey-gate, the entire mandate is mock-signed (MOCK-DEV-SIGNER). Here, the
`userAuthorization` proof inside the mandate is the **wallet's real signature over the
$ amount** (the signed `transaction_data_hash`). The AP2 envelope around it is still our
own JSON, but the consent binding it carries is cryptographically genuine. The only
remaining mock is the absence of a real issuer/ASPSP trust check (advisory trust posture).

## Architecture

```
Claude (skill)  ──"buy X for $Y at merchant M"──▶  helper (server.js)
                                                      │ buildCart (amount+cartHash)
                                                      │ embeds cart total+payee as transaction_data
                                                      │ mints signed OpenID4VP request (SKI reader cert)
   checkout.html ◀── /request ── serves QR ───────────┘
        │ navigator.credentials.get({digital})
        ▼
   📱 Multipaz wallet  ── signs DeviceResponse w/ transaction_data_hash ──▶
        │ encrypted vp_token returns THROUGH the page
        ▼
   helper /result: decrypt → recompute hash → VERIFY → emit ap2.PaymentMandate (stdout)
        │
        ▼
   validate.js: 4 deterministic gates → PASS/FAIL ; skill narrates verdict
```

## Components

`spike/dc-payment-gate/`:

| File | Responsibility |
|---|---|
| `server.js` | Path A helper. CLI args `--item --price --currency --merchant`. Builds cart + transaction_data (amount = cart.total, payee = merchant), signs the OpenID4VP request, serves the page, on `/result` decrypts the JWE, decodes the mdoc, recomputes & verifies the hash, assembles the mandate, emits it on stdout. |
| `checkout.html` | Fetches `/request`, calls `navigator.credentials.get({digital})`, POSTs the result back. |
| `mdoc.mjs` | Structural DeviceResponse decoder (copied from dc-gate-probe). Surfaces disclosed claims + the deviceSigned `transaction_data_hash`. |
| `mandate-wrapper.js` | `buildCart({item,price,currency,merchant})` and `buildPaymentMandate(cart, vpToken, disclosedFields, transactionData, verifiedHash)`. |
| `validate.js` | The 4 gates. Reads mandate JSON on stdin, independently re-derives gate 1, prints PASS/FAIL per gate, exits 0 (all pass) / 1 (any fail). |
| `run.sh` | `node server.js | node validate.js` (or `--raw` to print the mandate). npm install if needed. |

`buildCart` mirrors passkey-gate: subtotal, tax 8.25%, shipping $5.99 if subtotal < $100,
`total`, and `cartHash` = SHA-256 over canonical cart JSON.

## Mandate shape

```jsonc
{
  "ap2.PaymentMandate": {
    "cart": { /* item, total, currency, merchant, cartHash */ },
    "payment": {
      "instrument": {                          // from disclosed DPC claims
        "issuer": "Utopia Bank",
        "instrumentId": "pi-77AABBCC",
        "maskedAccount": "****1234",
        "holder": "Erika Mustermann",
        "expiry": "2028-09-01"
      }
    },
    "userAuthorization": {
      "type": "openid4vp-dc-api",
      "transactionData": "<original base64url transaction_data string>",
      "transactionDataHash": "<wallet-signed hash from the vpToken, real>",
      "vpToken": "<base64 DeviceResponse — the wallet signature lives here>",
      "verified": true                          // helper recomputed & matched
    },
    "subject": { "credentialId": "pi-77AABBCC" } // binds mandate to disclosed instrument
  }
}
```

## The 4 validation gates (deterministic, in `validate.js`)

`validate.js` does NOT trust the helper's `verified:true`; it independently re-derives
gate 1 from the mandate's cart and the transaction_data construction.

1. **Amount binding (the real upgrade).** Two independent checks, because the
   transaction_data carries a random `transaction_id` that can't be reconstructed from the
   cart alone:
   (a) **Hash integrity** — `SHA-256(userAuthorization.transactionData)` must equal the
   `transaction_data_hash` extracted *from the decoded vpToken* (not the helper's copy).
   Proves the wallet signed over exactly this transaction_data string.
   (b) **Cart consistency** — decode `transactionData` and assert its `payload.amount` ==
   `cart.total` and `payload.payee` == `cart.merchant`. Proves the signed string actually
   describes this cart. Together: biometric consent was over *this exact amount and payee*.
2. **Authorization present & structurally valid.** `vpToken` decodes to a DeviceResponse
   with a `deviceAuth` signature block and non-empty `issuerAuth`. Structural only — no
   trust-chain verification (advisory-trust posture).
3. **Credential not expired.** Disclosed `expiry_date` is future, and MSO
   `validityInfo.validUntil` has not passed.
4. **Subject binding.** `subject.credentialId` matches disclosed `payment_instrument_id`
   and instrument fields are present.

All 4 pass → skill reports "✓ Purchase authorized", prints disclosed instrument + bound
amount, ends with the dry-run line "Skill would now call merchant.checkoutComplete(mandate)".
Any fail → "✗ Rejected at gate N" with reason. No money moves; no merchant contacted.

## Skill integration

Extend the existing `agentic-purchase-gate` skill with a **DC branch** (its name is
mechanism-agnostic and the "buy X for $Y" intent parsing is shared). The skill detects /
selects the DC-payment path vs the passkey path, runs `run.sh`, reads validate.js's
verdict, and narrates it. The skill stays a thin orchestrator; the cryptographic claim
lives in `validate.js`.

*(Alternative, if preferred later: a fully separate skill, one skill = one mechanism.
Rejected for now to avoid duplicating intent parsing.)*

## Testing plan

1. **Unit** — `validate.js` against fixtures: one valid mandate + one tampered per gate
   (wrong amount, stripped vpToken, expired, mismatched subject). Each must fail the right gate.
2. **Integration** — real device run: `buy a pair of headphones for $89 at Demo Merchant`
   → scan → confirm wallet shows **$89** (cart total, not a hardcoded amount) → mandate
   emitted → all 4 gates pass.
3. **Negative** — hand-edit the emitted mandate's `cart.total`, re-run `validate.js` →
   gate 1 must fail (proves the binding is load-bearing, not decorative).

## Security / scope constraints (in effect)

- Spike crypto for the AP2 envelope is structural; the **authorization binding is real**
  (wallet-signed). No MOCK-DEV-SIGNER on the authorization.
- No money moves; no real merchant or ASPSP contacted.
- Self-signed reader cert is untrusted (advisory) — user sees an unverified-verifier warning.
- Reader cert MUST carry a Subject Key Identifier extension (avoids the wallet's
  `subjectKeyIdentifier!!` NPE — see dc-gate-probe).

## Open questions

- None blocking. Skill packaging (extend vs separate) defaulted to "extend"; revisit if
  the DC branch grows large enough to warrant its own skill.
