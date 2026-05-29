// test/tx-data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "../tx-data.js";

test("buildTransactionData maps a cart to the payment-SCA shape", () => {
  const cart = { currency: "USD", totals: { total: "89.24" }, merchant: { id: "m.example.com", name: "M Inc." } };
  const td = buildTransactionData(cart);
  assert.equal(td.type, "urn:eudi:sca:payment:1");
  assert.deepEqual(td.credential_ids, ["dpc"]);
  assert.equal(td.payload.amount, 89.24);
  assert.equal(td.payload.currency, "USD");
  assert.deepEqual(td.payload.payee, { id: "m.example.com", name: "M Inc." });
  assert.equal(typeof td.payload.transaction_id, "string");
});

test("hash is base64url(SHA-256(utf8(txDataB64)))", async () => {
  const b64 = encodeTransactionData({ a: 1 });
  const h = await hashTransactionData(b64);
  // base64url: no +,/,= padding
  assert.match(h, /^[A-Za-z0-9_-]+$/);
});
