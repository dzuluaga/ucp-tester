# DC-payment-gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost helper + skill branch that turns a purchase intent into a wallet-signed AP2 payment mandate over the proven DC API Path A flow, validated by 4 deterministic gates.

**Architecture:** A `spike/dc-payment-gate/` sibling of `spike/passkey-gate/`. `server.js` reuses dc-gate-probe's Path A harness (SKI reader cert, ephemeral enc key, signed OpenID4VP), builds a cart-driven `transaction_data`, and on `/result` decrypts the JWE, verifies the wallet-signed `transaction_data_hash`, and emits an `ap2.PaymentMandate`. `validate.js` independently re-checks 4 gates. The skill orchestrates and narrates.

**Tech Stack:** Node 18+ ESM, express, jose, @peculiar/x509, cbor-x. Tests use built-in `node --test`. No new dependencies beyond what dc-gate-probe already uses.

---

## File Structure

`spike/dc-payment-gate/`:

| File | Responsibility |
|---|---|
| `package.json` | deps + `test` script |
| `mdoc.mjs` | copied verbatim from dc-gate-probe — decodes `issuerSigned` claims |
| `tx-data.js` | single source of truth for the `transaction_data` shape + hashing |
| `vp-inspect.mjs` | extracts the `deviceSigned` `transaction_data_hash` + auth-block presence (the gap mdoc.mjs doesn't cover) |
| `mandate-wrapper.js` | `buildCart` + `buildPaymentMandate` |
| `validate.js` | 4 gates; CLI reads mandate on stdin, exits 0/1 |
| `server.js` | Path A helper; emits mandate on stdout |
| `public/checkout.html` | drives `navigator.credentials.get({digital})` |
| `run.sh` | `node server.js | node validate.js` (or `--raw`) |
| `test/fixtures.mjs` | builds consistent + tamperable mandate/vpToken fixtures |
| `test/*.test.js` | unit tests |

`skills/agentic-purchase-gate/SKILL.md` — modified: add a DC-payment-gate branch.

**Key technical note for all tasks:** the wallet signs `transaction_data_hash` into `deviceSigned.nameSpaces["urn:eudi:sca:payment:1"]`, NOT `issuerSigned`. `mdoc.mjs` only walks `issuerSigned`, so a dedicated extractor (`vp-inspect.mjs`) is required. The hash equals `base64url(SHA-256(utf8(txDataB64)))` where `txDataB64 = base64url(utf8(JSON.stringify(txData)))`. This was verified byte-for-byte in the v3 probe.

---

## Task 1: Scaffold the directory

**Files:**
- Create: `spike/dc-payment-gate/package.json`
- Create: `spike/dc-payment-gate/mdoc.mjs` (copy)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ucp-tester-dc-payment-gate",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "dependencies": {
    "@peculiar/x509": "^1.12.3",
    "cbor-x": "^1.6.0",
    "express": "^4.21.2",
    "jose": "^5.9.6"
  }
}
```

- [ ] **Step 2: Copy mdoc.mjs verbatim from the probe**

Run: `cp spike/dc-gate-probe/mdoc.mjs spike/dc-payment-gate/mdoc.mjs`
Expected: file copied, no output.

- [ ] **Step 3: Install deps**

Run: `cd spike/dc-payment-gate && npm install`
Expected: `node_modules/` created, exit 0.

- [ ] **Step 4: Commit**

```bash
git add spike/dc-payment-gate/package.json spike/dc-payment-gate/mdoc.mjs
git commit -m "scaffold dc-payment-gate: package.json + copied mdoc decoder"
```

---

## Task 2: tx-data.js (transaction_data single source of truth)

**Files:**
- Create: `spike/dc-payment-gate/tx-data.js`
- Test: `spike/dc-payment-gate/test/tx-data.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spike/dc-payment-gate && node --test test/tx-data.test.js`
Expected: FAIL — "Cannot find module '../tx-data.js'".

- [ ] **Step 3: Write the implementation**

```js
// tx-data.js — single source of truth for the OpenID4VP transaction_data entry.
// The amount/payee come from the cart; transaction_id is fresh per request.
import * as jose from "jose";

export function buildTransactionData(cart) {
  return {
    type: "urn:eudi:sca:payment:1",
    credential_ids: ["dpc"],
    payload: {
      transaction_id: globalThis.crypto.randomUUID(),
      amount: Number(cart.totals.total),
      currency: cart.currency,
      payee: { id: cart.merchant.id, name: cart.merchant.name },
    },
  };
}

export function encodeTransactionData(txData) {
  return jose.base64url.encode(new TextEncoder().encode(JSON.stringify(txData)));
}

export async function hashTransactionData(txDataB64) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(txDataB64));
  return jose.base64url.encode(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spike/dc-payment-gate && node --test test/tx-data.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add spike/dc-payment-gate/tx-data.js spike/dc-payment-gate/test/tx-data.test.js
git commit -m "dc-payment-gate: transaction_data builder + hasher with tests"
```

---

## Task 3: vp-inspect.mjs (deviceSigned hash extractor)

**Files:**
- Create: `spike/dc-payment-gate/vp-inspect.mjs`
- Create: `spike/dc-payment-gate/test/fixtures.mjs`
- Test: `spike/dc-payment-gate/test/vp-inspect.test.js`

- [ ] **Step 1: Write the fixture builder** (shared by Tasks 3 & 4)

```js
// test/fixtures.mjs — builds CBOR DeviceResponse + mandate fixtures for unit tests.
import { encode, Tag } from "cbor-x";
import * as jose from "jose";
import { buildCart } from "../mandate-wrapper.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "../tx-data.js";

// Build a base64url mdoc DeviceResponse with a transaction_data_hash in deviceSigned.
export function buildVpToken({ txHashBytes, instrumentId = "pi-77AABBCC", expiry = "2028-09-01", omitDeviceAuth = false, omitHash = false }) {
  const isi = (digestID, el, val) =>
    new Tag(encode({ digestID, random: new Uint8Array(8), elementIdentifier: el, elementValue: val }), 24);
  const devMap = omitHash ? {} : { "urn:eudi:sca:payment:1": { transaction_data_hash: txHashBytes } };
  const doc = {
    docType: "org.multipaz.payment.sca.1",
    issuerSigned: {
      nameSpaces: {
        "org.multipaz.payment.sca.1": [
          isi(5, "payment_instrument_id", instrumentId),
          isi(2, "expiry_date", new Tag(expiry, 1004)),
        ],
      },
      issuerAuth: ["a", "b", "c", "d"],
    },
    deviceSigned: {
      nameSpaces: new Tag(encode(devMap), 24),
      ...(omitDeviceAuth ? {} : { deviceAuth: { deviceSignature: ["a", null, null, new Uint8Array(64)] } }),
    },
  };
  return Buffer.from(encode({ version: "1.0", status: 0, documents: [doc] })).toString("base64url");
}

// A fully self-consistent mandate (all 4 gates pass) plus the context to tamper it.
export async function makeConsistentMandate() {
  const cart = buildCart({ item: "Headphones", price: "89", currency: "USD" });
  const txData = buildTransactionData(cart);
  const txDataB64 = encodeTransactionData(txData);
  const hashB64 = await hashTransactionData(txDataB64);
  const hashBytes = new Uint8Array(jose.base64url.decode(hashB64));
  const vpStr = buildVpToken({ txHashBytes: hashBytes });
  const mandate = {
    type: "ap2.PaymentMandate",
    subject: { credentialId: "pi-77AABBCC" },
    cart,
    payment: { instrument: { instrumentId: "pi-77AABBCC" }, amount: cart.totals.total, currency: "USD" },
    userAuthorization: {
      type: "openid4vp-dc-api",
      transactionData: txDataB64,
      transactionDataHash: hashB64,
      vpToken: vpStr,
      verified: true,
    },
  };
  return { mandate, ctx: { cart, txDataB64, hashBytes } };
}
```

- [ ] **Step 2: Write the failing test**

```js
// test/vp-inspect.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { extractTransactionDataHash, inspectAuthBlocks } from "../vp-inspect.mjs";
import { buildVpToken } from "./fixtures.mjs";

test("extractTransactionDataHash reads the deviceSigned hash as base64url", () => {
  const bytes = new Uint8Array(32).fill(7);
  const vp = buildVpToken({ txHashBytes: bytes });
  assert.equal(extractTransactionDataHash(vp), jose.base64url.encode(bytes));
});

test("extractTransactionDataHash returns null when absent", () => {
  const vp = buildVpToken({ txHashBytes: new Uint8Array(32), omitHash: true });
  assert.equal(extractTransactionDataHash(vp), null);
});

test("inspectAuthBlocks reports issuerAuth + deviceAuth presence", () => {
  const present = buildVpToken({ txHashBytes: new Uint8Array(32) });
  assert.deepEqual(inspectAuthBlocks(present), { hasIssuerAuth: true, hasDeviceAuth: true, docType: "org.multipaz.payment.sca.1" });
  const noDev = buildVpToken({ txHashBytes: new Uint8Array(32), omitDeviceAuth: true });
  assert.equal(inspectAuthBlocks(noDev).hasDeviceAuth, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd spike/dc-payment-gate && node --test test/vp-inspect.test.js`
Expected: FAIL — "Cannot find module '../vp-inspect.mjs'". (mandate-wrapper.js does not exist yet either; that's fine — this task only needs vp-inspect; fixtures imports mandate-wrapper, so this test will surface that too. Proceed to Step 4 which creates vp-inspect; mandate-wrapper arrives in Task 4. To run Task 3 in isolation, temporarily it is expected to fail on the missing mandate-wrapper import — see Step 5 note.)

- [ ] **Step 4: Write the implementation**

```js
// vp-inspect.mjs — surfaces the deviceSigned transaction_data_hash and auth-block
// presence. mdoc.mjs only walks issuerSigned; the payment binding lives in deviceSigned.
import { decode, Tag } from "cbor-x";

function b64urlToBytes(s) { return new Uint8Array(Buffer.from(String(s), "base64url")); }
function unwrap24(v) {
  if (v instanceof Tag) return decode(v.value);
  if (v instanceof Uint8Array) return decode(v);
  return v;
}

export function extractTransactionDataHash(vpStr, namespace = "urn:eudi:sca:payment:1", element = "transaction_data_hash") {
  const dr = decode(b64urlToBytes(vpStr));
  for (const doc of dr.documents ?? []) {
    const ns = unwrap24(doc.deviceSigned?.nameSpaces);
    const val = ns?.[namespace]?.[element];
    if (val instanceof Uint8Array) return Buffer.from(val).toString("base64url");
  }
  return null;
}

export function inspectAuthBlocks(vpStr) {
  const dr = decode(b64urlToBytes(vpStr));
  const doc = (dr.documents ?? [])[0] ?? {};
  const issuerAuth = doc.issuerSigned?.issuerAuth;
  const deviceAuth = doc.deviceSigned?.deviceAuth;
  return {
    hasIssuerAuth: Array.isArray(issuerAuth) && issuerAuth.length > 0,
    hasDeviceAuth: !!(deviceAuth && (deviceAuth.deviceSignature || deviceAuth.deviceMac)),
    docType: doc.docType ?? null,
  };
}
```

- [ ] **Step 5: Create mandate-wrapper.js stub so fixtures import resolves, then run**

The fixture imports `buildCart` from `mandate-wrapper.js`. Task 4 builds it fully; create it now so this test runs. Write the full `mandate-wrapper.js` from Task 4 Step 3 **now** (it has no dependency on this task), then:

Run: `cd spike/dc-payment-gate && node --test test/vp-inspect.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add spike/dc-payment-gate/vp-inspect.mjs spike/dc-payment-gate/test/fixtures.mjs spike/dc-payment-gate/test/vp-inspect.test.js spike/dc-payment-gate/mandate-wrapper.js
git commit -m "dc-payment-gate: deviceSigned hash extractor + CBOR fixtures"
```

---

## Task 4: mandate-wrapper.js (buildCart + buildPaymentMandate)

**Files:**
- Create: `spike/dc-payment-gate/mandate-wrapper.js` (already written in Task 3 Step 5 — this task adds its tests)
- Test: `spike/dc-payment-gate/test/mandate-wrapper.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spike/dc-payment-gate && node --test test/mandate-wrapper.test.js`
Expected: If Task 3 Step 5 already created mandate-wrapper.js, these tests run and PASS. If not, FAIL on missing module — then write Step 3.

- [ ] **Step 3: Write the implementation** (this is the file referenced in Task 3 Step 5)

```js
// mandate-wrapper.js — cart math (mirrors passkey-gate) + DC payment mandate.
// Unlike passkey-gate, there is NO MOCK-DEV-SIGNER: the authorization proof is the
// wallet-signed transaction_data_hash carried in userAuthorization.
import { randomUUID } from "node:crypto";

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => round2(n).toFixed(2);

export function buildCart({ item, price, currency = "USD", merchantId = "demo-merchant.example.com", merchantName = "Demo Merchant Inc." }) {
  const unitPrice = Number(price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error(`buildCart: price must be a positive number, got ${price}`);
  }
  const subtotal = unitPrice;
  const tax = round2(subtotal * 0.0825);
  const shipping = subtotal >= 100 ? 0 : 5.99;
  const total = round2(subtotal + tax + shipping);
  return {
    id: "cart_" + Math.random().toString(36).slice(2, 10),
    merchant: { id: merchantId, name: merchantName },
    currency,
    lineItems: [{ sku: "ITEM-001", description: item, quantity: 1, unitPrice: fmt(unitPrice), lineTotal: fmt(subtotal) }],
    totals: { subtotal: fmt(subtotal), tax: fmt(tax), shipping: fmt(shipping), total: fmt(total) },
  };
}

export function buildPaymentMandate({ cart, vpStr, claims, transactionDataB64, tokenHash, verified }) {
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const expiry = claims.expiry_date && typeof claims.expiry_date === "object" ? claims.expiry_date.value : (claims.expiry_date ?? null);
  const instrument = {
    issuer: claims.issuer_name ?? null,
    instrumentId: claims.payment_instrument_id ?? null,
    maskedAccount: claims.masked_account_reference ?? null,
    holder: claims.holder_name ?? null,
    expiry,
  };
  return {
    type: "ap2.PaymentMandate",
    version: "0.1-dc",
    id: "mandate_pm_" + randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    issuer: "did:web:ucp-tester.local",
    subject: { credentialId: instrument.instrumentId },
    cart,
    payment: { instrument, amount: cart.totals.total, currency: cart.currency },
    userAuthorization: {
      type: "openid4vp-dc-api",
      transactionData: transactionDataB64,
      transactionDataHash: tokenHash,
      vpToken: vpStr,
      verified: !!verified,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spike/dc-payment-gate && node --test test/mandate-wrapper.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add spike/dc-payment-gate/test/mandate-wrapper.test.js
git commit -m "dc-payment-gate: mandate-wrapper tests (cart math + mandate shape)"
```

---

## Task 5: validate.js (the 4 deterministic gates)

**Files:**
- Create: `spike/dc-payment-gate/validate.js`
- Test: `spike/dc-payment-gate/test/validate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { runGates } from "../validate.js";
import { makeConsistentMandate, buildVpToken } from "./fixtures.mjs";

const pass = (results, gate) => results.find((r) => r.gate === gate)?.pass;

test("all 4 gates pass for a consistent mandate", async () => {
  const { mandate } = await makeConsistentMandate();
  const results = await runGates(mandate);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.pass), JSON.stringify(results, null, 2));
});

test("gate 1 fails when cart.total is tampered", async () => {
  const { mandate } = await makeConsistentMandate();
  mandate.cart.totals.total = "999.00";
  const results = await runGates(mandate);
  assert.equal(pass(results, "Amount binding"), false);
  assert.equal(pass(results, "Subject binding"), true); // others unaffected
});

test("gate 2 fails when deviceAuth is stripped", async () => {
  const { mandate, ctx } = await makeConsistentMandate();
  mandate.userAuthorization.vpToken = buildVpToken({ txHashBytes: ctx.hashBytes, omitDeviceAuth: true });
  const results = await runGates(mandate);
  assert.equal(pass(results, "Authorization present"), false);
  assert.equal(pass(results, "Amount binding"), true); // hash still matches
});

test("gate 3 fails when the credential is expired", async () => {
  const { mandate, ctx } = await makeConsistentMandate();
  mandate.userAuthorization.vpToken = buildVpToken({ txHashBytes: ctx.hashBytes, expiry: "2020-01-01" });
  const results = await runGates(mandate);
  assert.equal(pass(results, "Credential not expired"), false);
});

test("gate 4 fails when subject does not match the disclosed instrument", async () => {
  const { mandate } = await makeConsistentMandate();
  mandate.subject.credentialId = "pi-DIFFERENT";
  const results = await runGates(mandate);
  assert.equal(pass(results, "Subject binding"), false);
  assert.equal(pass(results, "Amount binding"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spike/dc-payment-gate && node --test test/validate.test.js`
Expected: FAIL — "Cannot find module '../validate.js'".

- [ ] **Step 3: Write the implementation**

```js
// validate.js — 4 deterministic gates. Independently re-derives gate 1 from the
// mandate's own fields; does NOT trust userAuthorization.verified.
import { readFileSync } from "node:fs";
import * as jose from "jose";
import { decodeVpToken } from "./mdoc.mjs";
import { extractTransactionDataHash, inspectAuthBlocks } from "./vp-inspect.mjs";
import { hashTransactionData } from "./tx-data.js";

function decodeTxData(b64) {
  return JSON.parse(new TextDecoder().decode(jose.base64url.decode(b64)));
}

export async function runGates(mandate) {
  const ua = mandate.userAuthorization ?? {};
  const cart = mandate.cart ?? {};
  const results = [];

  // Gate 1 — amount binding: (a) hash integrity, (b) cart consistency.
  const tokenHash = ua.vpToken ? extractTransactionDataHash(ua.vpToken) : null;
  const recomputed = ua.transactionData ? await hashTransactionData(ua.transactionData) : null;
  const txd = ua.transactionData ? decodeTxData(ua.transactionData) : {};
  const hashOk = !!tokenHash && tokenHash === recomputed;
  const amountOk = Number(txd?.payload?.amount) === Number(cart?.totals?.total);
  const payeeOk = txd?.payload?.payee?.id === cart?.merchant?.id;
  results.push({ gate: "Amount binding", pass: hashOk && amountOk && payeeOk,
    detail: `hash ${hashOk ? "✓" : "✗"} (token=${tokenHash}) · amount ${amountOk ? "✓" : "✗"} (${txd?.payload?.amount} vs ${cart?.totals?.total}) · payee ${payeeOk ? "✓" : "✗"}` });

  // Gate 2 — authorization present & structurally valid.
  const auth = ua.vpToken ? inspectAuthBlocks(ua.vpToken) : { hasIssuerAuth: false, hasDeviceAuth: false };
  results.push({ gate: "Authorization present", pass: auth.hasIssuerAuth && auth.hasDeviceAuth,
    detail: `issuerAuth ${auth.hasIssuerAuth ? "✓" : "✗"} · deviceAuth ${auth.hasDeviceAuth ? "✓" : "✗"}` });

  // Gate 3 — credential not expired (disclosed expiry_date).
  const disclosed = ua.vpToken ? decodeVpToken({ dpc: ua.vpToken }) : [];
  const claims = Object.fromEntries((disclosed[0]?.claims ?? []).map((c) => [c.label.split(" / ").pop(), c.value]));
  const expRaw = claims["expiry_date"];
  const expStr = expRaw && typeof expRaw === "object" ? expRaw.value : expRaw;
  const notExpired = !!expStr && new Date(expStr).getTime() > Date.now();
  results.push({ gate: "Credential not expired", pass: notExpired, detail: `expiry_date=${expStr}` });

  // Gate 4 — subject binding (re-derive instrument id from the token).
  const instrumentId = claims["payment_instrument_id"];
  const subjectOk = !!instrumentId && mandate.subject?.credentialId === instrumentId;
  results.push({ gate: "Subject binding", pass: subjectOk, detail: `subject=${mandate.subject?.credentialId} · instrument=${instrumentId}` });

  return results;
}

// CLI: read a mandate on stdin, print per-gate verdict, exit 0 (all pass) / 1 (any fail).
if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
  if (!raw.trim()) { process.stderr.write("[gate] no mandate on stdin (helper did not emit one)\n"); process.exit(2); }
  let mandate;
  try { mandate = JSON.parse(raw); } catch (e) { process.stderr.write(`[gate] invalid mandate JSON: ${e}\n`); process.exit(2); }
  const results = await runGates(mandate);
  let allPass = true;
  for (const r of results) { allPass = allPass && r.pass; process.stderr.write(`[gate] ${r.pass ? "✓" : "✗"} ${r.gate} — ${r.detail}\n`); }
  process.stdout.write(JSON.stringify({ authorized: allPass, gates: results, mandate }, null, 2) + "\n");
  process.exit(allPass ? 0 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spike/dc-payment-gate && node --test test/validate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite**

Run: `cd spike/dc-payment-gate && node --test`
Expected: PASS (all tests across tx-data, vp-inspect, mandate-wrapper, validate).

- [ ] **Step 6: Commit**

```bash
git add spike/dc-payment-gate/validate.js spike/dc-payment-gate/test/validate.test.js
git commit -m "dc-payment-gate: 4 deterministic gates with tamper tests"
```

---

## Task 6: server.js (Path A helper, cart-driven, emits mandate)

**Files:**
- Create: `spike/dc-payment-gate/server.js`

This adapts `spike/dc-gate-probe/probe.js` (the proven harness). No test here — it's the integration surface, exercised in Task 8.

- [ ] **Step 1: Write server.js in full**

```js
// DC-payment-gate helper. Path A localhost: signs an OpenID4VP request binding the
// cart's amount+payee as transaction_data, serves the QR page, and on /result decrypts
// the JWE, verifies the wallet-signed transaction_data_hash, and emits an ap2.PaymentMandate.
import express from "express";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import * as jose from "jose";
import * as x509 from "@peculiar/x509";
import { decodeVpToken } from "./mdoc.mjs";
import { extractTransactionDataHash } from "./vp-inspect.mjs";
import { buildCart, buildPaymentMandate } from "./mandate-wrapper.js";
import { buildTransactionData, encodeTransactionData, hashTransactionData } from "./tx-data.js";

const webcrypto = globalThis.crypto;
x509.cryptoProvider.set(webcrypto);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 120_000;

const { values: argv } = parseArgs({ options: {
  item: { type: "string", default: "Demo item" },
  price: { type: "string", default: "41.71" },
  currency: { type: "string", default: "USD" },
  merchant: { type: "string", default: "demo-merchant.example.com" },
  "merchant-name": { type: "string", default: "Demo Merchant Inc." },
} });

const cart = buildCart({ item: argv.item, price: argv.price, currency: argv.currency, merchantId: argv.merchant, merchantName: argv["merchant-name"] });

// Reader cert (ES256, SAN dNSName=localhost). The Subject Key Identifier extension is
// REQUIRED — without it the wallet's TrustManagerUtil does subjectKeyIdentifier!! → NPE.
const signAlg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const readerKeys = await webcrypto.subtle.generateKey(signAlg, true, ["sign", "verify"]);
const cert = await x509.X509CertificateGenerator.createSelfSigned({
  serialNumber: "01", name: "CN=localhost",
  notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 86_400_000),
  signingAlgorithm: signAlg, keys: readerKeys,
  extensions: [
    new x509.SubjectAlternativeNameExtension([{ type: "dns", value: "localhost" }]),
    await x509.SubjectKeyIdentifierExtension.create(readerKeys.publicKey),
  ],
});
const x5c = cert.toString("base64");

// Ephemeral P-256 key the wallet encrypts its response to.
const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
const encJwk = { kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y, use: "enc", alg: "ECDH-ES", kid: "response-encryption-key" };
const encPrivKey = await jose.importJWK(await webcrypto.subtle.exportKey("jwk", encKP.privateKey), "ECDH-ES");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(join(__dirname, "public")));
const port = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s.address().port)); });
const origin = `http://localhost:${port}`;

// transaction_data bound to THIS cart (amount = cart total, payee = merchant).
const txData = buildTransactionData(cart);
const txDataB64 = encodeTransactionData(txData);
const expectedTxHashB64url = await hashTransactionData(txDataB64);

const nonce = jose.base64url.encode(webcrypto.getRandomValues(new Uint8Array(16)));
const requestObject = {
  response_type: "vp_token", response_mode: "dc_api.jwt",
  client_id: "x509_san_dns:localhost", expected_origins: [origin], nonce,
  dcql_query: { credentials: [{ id: "dpc", format: "mso_mdoc",
    meta: { doctype_value: "org.multipaz.payment.sca.1" },
    claims: [
      { path: ["org.multipaz.payment.sca.1", "issuer_name"], intent_to_retain: false },
      { path: ["org.multipaz.payment.sca.1", "payment_instrument_id"], intent_to_retain: false },
      { path: ["org.multipaz.payment.sca.1", "masked_account_reference"], intent_to_retain: false },
      { path: ["org.multipaz.payment.sca.1", "holder_name"], intent_to_retain: false },
      { path: ["org.multipaz.payment.sca.1", "issue_date"], intent_to_retain: false },
      { path: ["org.multipaz.payment.sca.1", "expiry_date"], intent_to_retain: false },
    ],
  }] },
  client_metadata: { vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } }, jwks: { keys: [encJwk] } },
  transaction_data: [txDataB64],
};
const signedJwt = await new jose.SignJWT(requestObject)
  .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
  .setIssuedAt().sign(readerKeys.privateKey);

app.get("/cart", (_req, res) => res.json(cart));
app.get("/request", (_req, res) => res.json({ protocol: "openid4vp-v1-signed", data: { request: signedJwt } }));

app.post("/result", async (req, res) => {
  const { ok, data, error } = req.body ?? {};
  if (!ok) {
    res.json({ received: true });
    process.stderr.write(`\n[gate] ✗ get({digital}) rejected: ${error}\n`);
    setTimeout(() => process.exit(3), 200); return;
  }
  try {
    let d = data; if (typeof d === "string") d = JSON.parse(d);
    const jwe = d?.response; if (!jwe) throw new Error("no .response (JWE) in result.data");
    const { plaintext } = await jose.compactDecrypt(jwe, encPrivKey);
    const openid4vpResponse = JSON.parse(new TextDecoder().decode(plaintext));
    const vpToken = openid4vpResponse.vp_token;             // { dpc: [ "<DeviceResponse b64url>" ] }
    const vpStr = Array.isArray(vpToken?.dpc) ? vpToken.dpc[0] : vpToken?.dpc;

    const disclosed = decodeVpToken(vpToken);
    const claims = Object.fromEntries((disclosed[0]?.claims ?? []).map((c) => [c.label.split(" / ").pop(), c.value]));
    const tokenHash = extractTransactionDataHash(vpStr);
    const verified = tokenHash === expectedTxHashB64url;

    const mandate = buildPaymentMandate({ cart, vpStr, claims, transactionDataB64: txDataB64, tokenHash, verified });
    res.json({ received: true, disclosed, verified });
    process.stderr.write(`\n[gate] ✓ presentation returned; transaction_data_hash ${verified ? "MATCHES" : "MISMATCH"} (token=${tokenHash} expected=${expectedTxHashB64url})\n`);
    process.stdout.write(JSON.stringify(mandate, null, 2) + "\n");
    setTimeout(() => process.exit(verified ? 0 : 4), 200);
  } catch (e) {
    res.json({ received: true, error: String(e) });
    process.stderr.write(`\n[gate] ✗ failed to assemble mandate: ${e}\n`);
    setTimeout(() => process.exit(5), 200);
  }
});

const url = `${origin}/checkout.html`;
process.stderr.write(
  `[gate] listening on ${origin}\n` +
  `[gate] cart total ${cart.totals.total} ${cart.currency} → payee ${cart.merchant.name}\n` +
  `[gate] reader cert SAN=localhost (self-signed, untrusted — expect a warning)\n` +
  `[gate] opening Chrome to ${url}\n`,
);
spawn("open", ["-a", "Google Chrome", url], { stdio: "ignore", detached: true }).unref();
setTimeout(() => { process.stderr.write(`[gate] timeout after ${TIMEOUT_MS}ms\n`); process.exit(124); }, TIMEOUT_MS);
```

- [ ] **Step 2: Syntax-check**

Run: `cd spike/dc-payment-gate && node --check server.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add spike/dc-payment-gate/server.js
git commit -m "dc-payment-gate: Path A helper (cart-driven transaction_data, emits mandate)"
```

---

## Task 7: checkout.html + run.sh

**Files:**
- Create: `spike/dc-payment-gate/public/checkout.html`
- Create: `spike/dc-payment-gate/run.sh`

- [ ] **Step 1: Copy the probe page as the checkout page**

Run: `mkdir -p spike/dc-payment-gate/public && cp spike/dc-gate-probe/public/probe.html spike/dc-payment-gate/public/checkout.html`
Expected: file copied.

- [ ] **Step 2: Update the page title + intro to mention the amount**

In `spike/dc-payment-gate/public/checkout.html`, replace the `<title>` line:

```html
<title>DC Payment Gate — present payment credential</title>
```

And replace the first `<h1>` line with:

```html
<h1>Agentic checkout — present your payment credential</h1>
```

Add, immediately after the opening `<body>` `<h1>`, a cart line the page fills in:

```html
<p id="cart" class="muted">Loading cart…</p>
```

And inside `<script type="module">`, after the `const btn = ...` line, add:

```js
fetch("/cart").then((r) => r.json()).then((c) => {
  document.getElementById("cart").textContent =
    `${c.lineItems[0].description} — ${c.totals.total} ${c.currency} to ${c.merchant.name}`;
}).catch(() => {});
```

(The rest of the page — `/request` fetch, `navigator.credentials.get({digital})`, POST to `/result`, `renderDisclosed` — is unchanged and already correct.)

- [ ] **Step 3: Create run.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --silent
fi
# server.js emits an ap2.PaymentMandate on stdout; validate.js runs the 4 gates.
# Pass --raw to skip validation and see the bare mandate.
if [ "${1:-}" = "--raw" ]; then
  shift
  node server.js "$@"
else
  node server.js "$@" | node validate.js
fi
```

- [ ] **Step 4: Make run.sh executable**

Run: `chmod +x spike/dc-payment-gate/run.sh`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add spike/dc-payment-gate/public/checkout.html spike/dc-payment-gate/run.sh
git commit -m "dc-payment-gate: checkout page + run.sh pipeline"
```

---

## Task 8: Integration + negative verification (on device)

**Files:** none (manual verification of the assembled system).

- [ ] **Step 1: Clear logcat on the wallet device**

Run: `adb -s 47271FDAS002LQ logcat -c`
Expected: buffer cleared.

- [ ] **Step 2: Run the gate for a real purchase, capturing the mandate**

Run: `cd spike/dc-payment-gate && ./run.sh --raw --item "wireless headphones" --price 89 > /tmp/dc-mandate.json`
Then scan the QR with the Multipaz wallet. **Confirm the wallet's consent screen shows $102.33 (cart total: 89 + 7.34 tax + 5.99 shipping), payee "Demo Merchant Inc."**, and approve.
Expected: helper exits 0; `/tmp/dc-mandate.json` contains the mandate with `userAuthorization.verified: true`.

- [ ] **Step 3: Run the gates against the captured mandate**

Run: `cd spike/dc-payment-gate && node validate.js < /tmp/dc-mandate.json`
Expected: stderr shows 4 `✓` gate lines; exit 0; stdout JSON has `"authorized": true`.

- [ ] **Step 4: Negative test — tamper the amount, re-validate**

Run: `cd spike/dc-payment-gate && node -e 'const m=require("fs").readFileSync("/tmp/dc-mandate.json","utf8");const o=JSON.parse(m);o.cart.totals.total="9.99";require("fs").writeFileSync("/tmp/dc-mandate-tampered.json",JSON.stringify(o))' && node validate.js < /tmp/dc-mandate-tampered.json; echo "exit=$?"`
Expected: "Amount binding ✗" gate line; `"authorized": false`; `exit=1`. Proves the binding is load-bearing.

- [ ] **Step 5: Document the result**

Append a short "DC-payment-gate" section to `spike/dc-gate-probe/FINDINGS.md` (or create `spike/dc-payment-gate/FINDINGS.md`) noting: end-to-end pass, the confirmed on-device amount, and that the negative test fails gate 1. Then commit:

```bash
git add spike/dc-payment-gate/FINDINGS.md
git commit -m "dc-payment-gate: record end-to-end + negative verification results"
```

---

## Task 9: Extend the agentic-purchase-gate skill with a DC branch

**Files:**
- Modify: `skills/agentic-purchase-gate/SKILL.md`

- [ ] **Step 1: Add a DC-payment-gate section before "## Scope and honesty"**

Insert this section:

```markdown
## DC-payment-gate variant (wallet-signed amount binding)

When the user asks for the **cross-device / digital-credential** payment path (phrases like
"use the payment credential", "DC payment gate", "wallet-signed mandate", or after the
passkey path when they want the amount cryptographically bound), drive
`../../spike/dc-payment-gate/run.sh` instead of passkey-gate. Same intent parsing.

```bash
../../spike/dc-payment-gate/run.sh --item "<ITEM>" --price <PRICE>
```

Foreground, timeout >= 180000ms. Tell the user one line first: *"Opening the payment-credential
gate — scan the QR with your wallet and confirm the amount."*

The helper opens Chrome with a cross-device QR. The user scans it with the Multipaz wallet,
which renders the **amount and payee** and signs a `transaction_data_hash` over them. The
encrypted response returns through the page; the helper emits an `ap2.PaymentMandate` whose
`userAuthorization` carries the **real wallet-signed hash** (no MOCK-DEV-SIGNER). The piped
`validate.js` runs the 4 gates and prints `{ "authorized": <bool>, "gates": [...] }`.

Exit codes: `0` all gates pass · `1` a gate failed (read the `gates` array) · `3` user
rejected · `4` hash mismatch · `5` decode/assembly error · `124` 120s timeout.

The 4 gates (already computed by `validate.js` — narrate its output, do not recompute):

| Gate | Check |
|---|---|
| Amount binding | `SHA-256(userAuthorization.transactionData)` == the hash signed in the vpToken's `deviceSigned`, AND the decoded transaction_data amount/payee == `cart.totals.total`/`cart.merchant.id` |
| Authorization present | vpToken decodes to a DeviceResponse with non-empty `issuerAuth` + a `deviceAuth` block |
| Credential not expired | disclosed `expiry_date` is in the future |
| Subject binding | `subject.credentialId` == the disclosed `payment_instrument_id` |

Real vs mock for this path: **real** = the wallet presentation, the amount binding (wallet-signed),
the disclosed instrument fields, the gate checks. **Mock** = no issuer/ASPSP trust verification
(self-signed reader cert, advisory trust); no money moves; no merchant contacted.
```

- [ ] **Step 2: Add a trigger note under "## When to use"**

After the existing trigger bullets, add:

```markdown
- For the digital-credential path specifically: "use the payment credential", "DC payment gate", "wallet-signed mandate" → use the DC-payment-gate variant (see below).
```

- [ ] **Step 3: Commit**

```bash
git add skills/agentic-purchase-gate/SKILL.md
git commit -m "agentic-purchase-gate: add DC-payment-gate branch (wallet-signed binding)"
```

---

## Self-Review

**Spec coverage:**
- Helper (server.js) ✓ Task 6 · checkout.html ✓ Task 7 · mdoc.mjs ✓ Task 1 · mandate-wrapper ✓ Task 4 · validate.js ✓ Task 5 · run.sh ✓ Task 7 — all File-Structure rows have a task.
- Mandate shape (cart/payment/userAuthorization with transactionData + hash + vpToken) ✓ Task 4.
- 4 gates ✓ Task 5; gate 1 two-part (hash integrity + cart consistency) ✓.
- Skill DC branch ✓ Task 9. Testing plan (unit + integration + negative) ✓ Tasks 2–5, 8.

**Deviation from spec (noted):** the spec's gate 3 mentioned "MSO `validityInfo.validUntil`". The plan narrows gate 3 to the **disclosed `expiry_date`** only — parsing the MSO requires COSE_Sign1 decoding, which adds complexity with no trust value under the advisory-trust posture (we don't verify issuer signatures anyway). The spec should be updated to match.

**Type/name consistency:** `buildPaymentMandate` takes an options object `{ cart, vpStr, claims, transactionDataB64, tokenHash, verified }` everywhere (Task 4 def, Task 6 call). `extractTransactionDataHash`/`inspectAuthBlocks` signatures match between Task 3 def and Task 5 use. `decodeVpToken({ dpc: <string> })` shape is consistent (server passes the full `{dpc:[...]}`; validate wraps the bare string as `{dpc: str}`). `runGates` returns `[{gate, pass, detail}]` — tests key on `gate` strings that match validate.js exactly.

**Placeholder scan:** no TBD/TODO; every code step has complete code.
