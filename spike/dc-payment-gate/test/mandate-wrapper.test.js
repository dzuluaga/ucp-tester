// test/mandate-wrapper.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCart, buildPaymentMandate } from "../mandate-wrapper.js";

test("buildCart computes tax (8.25%) + shipping ($5.99 under $100) + total", () => {
  const cart = buildCart({ item: "Headphones", price: "89" });
  assert.equal(cart.totals.subtotal, "89.00");
  assert.equal(cart.totals.tax, "7.34");      // 89 * 0.0825 = 7.3425 -> 7.34
  assert.equal(cart.totals.shipping, "5.99");
  assert.equal(cart.totals.total, "102.33");  // 89 + 7.34 + 5.99
  assert.equal(cart.currency, "USD");
});

test("buildCart waives shipping at >= $100 subtotal", () => {
  const cart = buildCart({ item: "Watch", price: "150" });
  assert.equal(cart.totals.shipping, "0.00");
});

test("buildCart rejects non-positive price", () => {
  assert.throws(() => buildCart({ item: "x", price: "0" }));
});

test("buildPaymentMandate carries the wallet hash, instrument, and binds subject", () => {
  const cart = buildCart({ item: "Headphones", price: "89" });
  const m = buildPaymentMandate({
    cart, vpStr: "VPSTR",
    claims: { issuer_name: "Utopia Bank", payment_instrument_id: "pi-77AABBCC", masked_account_reference: "****1234", holder_name: "Erika Mustermann", expiry_date: { _tag: 1004, value: "2028-09-01" } },
    transactionDataB64: "TXB64", tokenHash: "HASH", verified: true,
  });
  assert.equal(m.type, "ap2.PaymentMandate");
  assert.equal(m.subject.credentialId, "pi-77AABBCC");
  assert.equal(m.payment.instrument.issuer, "Utopia Bank");
  assert.equal(m.payment.instrument.expiry, "2028-09-01");
  assert.equal(m.userAuthorization.transactionData, "TXB64");
  assert.equal(m.userAuthorization.transactionDataHash, "HASH");
  assert.equal(m.userAuthorization.vpToken, "VPSTR");
  assert.equal(m.userAuthorization.verified, true);
  assert.ok(!("signature" in m), "no mock signer on the authorization");
});
