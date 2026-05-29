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
// What we're asking the wallet to sign over: the transaction_data payload (amount + payee)
// and the hash we expect the wallet to sign (SHA-256 of the base64url transaction_data string).
app.get("/sent", (_req, res) => res.json({ cart, transactionData: txData, transactionDataB64: txDataB64, expectedHash: expectedTxHashB64url }));
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
    res.json({ received: true, disclosed, verified, expectedHash: expectedTxHashB64url, signedHash: tokenHash, mandate });
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
