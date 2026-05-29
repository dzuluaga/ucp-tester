# DC-payment-gate — findings

**Date:** 2026-05-28
**Builds on:** `spike/dc-gate-probe/` (proven Path A signed harness)

## End-to-end (on device)

`./run.sh --raw --item "wireless headphones" --price 89` over Path A localhost:

- Cart total **$102.33 USD** ($89.00 + $7.34 tax @8.25% + $5.99 shipping), payee **Demo Merchant Inc.**
- Multipaz wallet rendered the amount + payee, signed a `transaction_data_hash` over them.
- Helper recomputed the hash and it **MATCHED byte-for-byte**:
  `y3PsqWNBP3oLjVzMVWOeaWXUoPKPjF0h0PDTpsdOggg`
- `ap2.PaymentMandate` emitted with `userAuthorization.verified: true` (real wallet-signed hash, no MOCK-DEV-SIGNER).

## The 4 gates (`validate.js`) — all PASS

```
✓ Amount binding       — hash ✓ · amount ✓ (102.33 vs 102.33) · payee ✓
✓ Authorization present — issuerAuth ✓ · deviceAuth ✓
✓ Credential not expired — expiry_date=2028-09-01
✓ Subject binding       — subject=pi-77AABBCC · instrument=pi-77AABBCC
```

`validate.js` exit 0; `{ "authorized": true }`.

## Negative test (binding is load-bearing)

Hand-edited the emitted mandate's `cart.totals.total` → `9.99`, re-ran `validate.js`:

```
✗ Amount binding — hash ✓ · amount ✗ (102.33 vs 9.99) · payee ✓
```

Exit 1; `{ "authorized": false }`. The hash-integrity check still holds (the wallet signed
over the original $102.33 transaction_data), but cart-consistency fails — proving the
amount binding is real, not decorative.

## Scope / posture

Real: wallet presentation, amount binding (wallet-signed `transaction_data_hash`), disclosed
instrument fields, gate checks. Mock: no issuer/ASPSP trust verification (self-signed reader
cert, advisory trust). No money moves; no merchant contacted.
