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
