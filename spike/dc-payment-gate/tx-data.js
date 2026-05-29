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
