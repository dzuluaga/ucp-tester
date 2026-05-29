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
