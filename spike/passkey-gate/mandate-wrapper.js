// Shared mandate-wrapping logic for the Phase 0 spike.
//
// `buildCart` constructs a demo cart from a single line item.
// `buildPaymentMandate` takes a verified WebAuthn assertion + a cart and
// produces a structurally-AP2-shaped Payment Mandate, embedding the assertion
// as `userAuthorization` evidence. Signature is a dev mock — production
// replaces this with AP2-conformant SD-JWT signing in the real payment adapter.
//
// In production this lives entirely in the payment adapter; the gate only
// returns the assertion. The spike collapses them so the browser and terminal
// can render the *same* mandate object during the demo.

import { createHash, randomUUID } from "node:crypto";

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
    lineItems: [
      { sku: "ITEM-001", description: item, quantity: 1, unitPrice: fmt(unitPrice), lineTotal: fmt(subtotal) },
    ],
    totals: { subtotal: fmt(subtotal), tax: fmt(tax), shipping: fmt(shipping), total: fmt(total) },
  };
}

export function buildPaymentMandate(assertion, cart) {
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);

  const payment = {
    instrument: "stripe_test",
    instrumentReference: "pi_3Mock" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    network: "card",
    amount: cart.totals.total,
    currency: cart.currency,
  };

  const mandateBody = {
    type: "ap2.PaymentMandate",
    version: "0.1-mock",
    id: "mandate_pm_" + randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    issuer: "did:web:ucp-tester.local",
    subject: { credentialID: assertion.authenticatorInfo.credentialID },
    cart,
    payment,
    userAuthorization: {
      type: "webauthn.assertion",
      verified: true,
      credentialID: assertion.authenticatorInfo.credentialID,
      userVerified: assertion.authenticatorInfo.userVerified,
      hardwareBacked:
        assertion.authenticatorInfo.credentialDeviceType === "multiDevice" ||
        assertion.authenticatorInfo.credentialDeviceType === "singleDevice",
      deviceType: assertion.authenticatorInfo.credentialDeviceType,
      backedUp: assertion.authenticatorInfo.credentialBackedUp,
      rpID: assertion.authenticatorInfo.rpID,
      origin: assertion.authenticatorInfo.origin,
      ceremonyTimestamp: assertion.timestamp,
    },
  };

  const digest = createHash("sha256").update(JSON.stringify(mandateBody)).digest("base64");

  return {
    ...mandateBody,
    signature: {
      alg: "MOCK-DEV-SIGNER",
      value: "mock-sig:" + digest,
      note: "Spike-only mock. Production replaces with AP2-conformant SD-JWT signing.",
    },
  };
}
