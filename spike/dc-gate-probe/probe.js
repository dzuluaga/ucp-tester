// Leg 0 — Path A *signed* probe for the cross-device Digital Credentials gate.
//
// v1 (unsigned) proved that desktop Chrome rejects an unsigned cross-device DC
// request outright (NetworkError, no QR) — Chrome only renders the cross-device QR
// for a SIGNED OpenID4VP request (openid4vp-v1-signed) carrying a reader X.509 cert.
//
// v2 tests whether "Path A signed" still keeps the clean localhost shape: this server
// mints a self-signed reader cert, signs the request, and hands it to the page. Chrome
// renders the QR, the Android Multipaz wallet presents the mDL, and the *encrypted*
// vp_token (dc_api.jwt JWE) returns THROUGH the page back to this localhost helper —
// the phone never contacts our server over the network. The server decrypts the JWE
// with its ephemeral key and prints the vp_token. If this works, the real spike stays
// a localhost sibling of passkey-gate (no tunnel) and only carries a reader cert.
//
// Throwaway feasibility probe: no mandate, no gates, mock self-signed reader trust —
// it just confirms the round-trip and shows the shape of what comes back.

import express from "express";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as jose from "jose";
import * as x509 from "@peculiar/x509";
import { decodeVpToken } from "./mdoc.mjs";

const webcrypto = globalThis.crypto;
x509.cryptoProvider.set(webcrypto);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 120_000;

// --- Self-signed reader cert + signing key (ES256, SAN dNSName=localhost). ---
// Multipaz does NOT hard-reject an untrusted reader cert (trust is advisory — the
// user just sees an "unverified verifier" consent prompt), so a self-signed cert
// is fine for the probe. client_id must be x509_san_dns:<the SAN>.
const signAlg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const readerKeys = await webcrypto.subtle.generateKey(signAlg, true, ["sign", "verify"]);
// NOTE: the Subject Key Identifier extension is REQUIRED, not cosmetic. When Multipaz
// can't chain our self-signed reader cert to a trust point it falls into a single-cert
// branch that does `chain[0].subjectKeyIdentifier!!.toHex()` (TrustManagerUtil.kt:136) — a
// non-null assertion. Without an SKI extension that `!!` throws NPE inside the wallet's
// trust resolution (OpenID4VP.generateResponse → resolveTrust), surfacing to the page as a
// bare NetworkError *after* a successful match. The mDL leg masked this; the payment-cred
// leg exposed it. Adding the SKI makes subjectKeyIdentifier non-null so trust resolves
// gracefully to "untrusted" (advisory — user just sees the unverified-verifier warning).
const cert = await x509.X509CertificateGenerator.createSelfSigned({
  serialNumber: "01",
  name: "CN=localhost",
  notBefore: new Date(Date.now() - 60_000),
  notAfter: new Date(Date.now() + 86_400_000),
  signingAlgorithm: signAlg,
  keys: readerKeys,
  extensions: [
    new x509.SubjectAlternativeNameExtension([{ type: "dns", value: "localhost" }]),
    await x509.SubjectKeyIdentifierExtension.create(readerKeys.publicKey),
  ],
});
const x5c = cert.toString("base64"); // standard base64 DER for the JWT x5c header

// --- Ephemeral P-256 encryption key the wallet encrypts the response to. ---
const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
const encJwk = {
  kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y,
  use: "enc", alg: "ECDH-ES", kid: "response-encryption-key",
};
const encPrivJwk = await webcrypto.subtle.exportKey("jwk", encKP.privateKey);
const encPrivKey = await jose.importJWK(encPrivJwk, "ECDH-ES");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(join(__dirname, "public")));

const port = await new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const origin = `http://localhost:${port}`;

// --- transaction_data: bind the PAYMENT (payee + amount) into the presentation. ---
// This is the v3 probe's whole point. A bare presentation just discloses card fields; a
// *payment authorization* binds the user's biometric consent to a specific amount. We send
// one OpenID4VP `transaction_data` entry of type urn:eudi:sca:payment:1 (Multipaz's
// `PaymentTransaction`, registered in the test app via addUtopiaTypes()). The wallet renders
// the amount in its consent prompt and signs a `transaction_data_hash` (SHA-256 over the
// base64url string below) into the DeviceResponse. credential_ids must match the DCQL id "dpc";
// payload shape mirrors PaymentTransaction.sampleData. We deliberately OMIT
// transaction_data_hashes_alg so the wallet defaults to SHA-256 and skips a `!!` on the
// hash-alg COSE identifier (avoids a known non-null-assert path).
const TX_AMOUNT = 45.16;
const TX_CURRENCY = "USD";
const txData = {
  type: "urn:eudi:sca:payment:1",
  credential_ids: ["dpc"],
  payload: {
    transaction_id: webcrypto.randomUUID(),
    amount: TX_AMOUNT,
    currency: TX_CURRENCY,
    payee: { id: "demo-merchant.example.com", name: "Demo Merchant Inc." },
  },
};
const txDataB64 = jose.base64url.encode(new TextEncoder().encode(JSON.stringify(txData)));
// What the wallet should hash and sign over (SHA-256 of the base64url string's UTF-8 bytes).
const expectedTxHashB64url = jose.base64url.encode(
  new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(txDataB64))),
);

// --- The signed OpenID4VP request (built now that the origin/port is known). ---
const nonce = jose.base64url.encode(webcrypto.getRandomValues(new Uint8Array(16)));
const requestObject = {
  response_type: "vp_token",
  response_mode: "dc_api.jwt",
  client_id: "x509_san_dns:localhost",
  expected_origins: [origin],
  nonce,
  // Request the mdoc Digital Payment Credential. doctype == namespace ==
  // "org.multipaz.payment.sca.1", and these six elements are the exact set from the
  // canonical Multipaz `payment_sca_minimal` sample request (multipaz-utopia
  // DigitalPaymentCredential.kt). Mirroring the sample 1:1 — an explicit claims list is
  // required (omitting it broke matching), and the minimal sample carries NO transaction_data,
  // so transaction_data is not needed to present this credential.
  dcql_query: {
    credentials: [{
      id: "dpc",
      format: "mso_mdoc",
      meta: { doctype_value: "org.multipaz.payment.sca.1" },
      claims: [
        { path: ["org.multipaz.payment.sca.1", "issuer_name"], intent_to_retain: false },
        { path: ["org.multipaz.payment.sca.1", "payment_instrument_id"], intent_to_retain: false },
        { path: ["org.multipaz.payment.sca.1", "masked_account_reference"], intent_to_retain: false },
        { path: ["org.multipaz.payment.sca.1", "holder_name"], intent_to_retain: false },
        { path: ["org.multipaz.payment.sca.1", "issue_date"], intent_to_retain: false },
        { path: ["org.multipaz.payment.sca.1", "expiry_date"], intent_to_retain: false },
      ],
    }],
  },
  client_metadata: {
    vp_formats_supported: {
      mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] },
    },
    jwks: { keys: [encJwk] },
  },
  // Bind the payment. One base64url-encoded JSON string per spec; the wallet decodes it,
  // looks up the registered PaymentTransaction type, renders the amount in its consent
  // prompt, and signs SHA-256(txDataB64) into the DeviceResponse.
  transaction_data: [txDataB64],
};
const signedJwt = await new jose.SignJWT(requestObject)
  .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
  .setIssuedAt()
  .sign(readerKeys.privateKey);

// The page fetches this and passes it straight to navigator.credentials.get({digital}).
app.get("/request", (_req, res) => {
  res.json({ protocol: "openid4vp-v1-signed", data: { request: signedJwt } });
});

// The page POSTs whatever get({digital}) resolved (or rejected) with.
app.post("/result", async (req, res) => {
  const { ok, protocol, data, error } = req.body ?? {};

  if (!ok) {
    res.json({ received: true });
    process.stderr.write(`\n[probe] ✗ get({digital}) rejected — see error below\n`);
    process.stderr.write(`[probe] ${error}\n`);
    setTimeout(() => process.exit(3), 200);
    return;
  }

  // ok === true: the JWE vp_token came back through the page → the cross-device
  // round-trip SUCCEEDED. Decrypting is a bonus; even a decrypt failure means Path A works.
  try {
    let d = data;
    if (typeof d === "string") d = JSON.parse(d);
    const jwe = d?.response;
    if (!jwe) throw new Error("no .response (JWE) in result.data: " + JSON.stringify(d).slice(0, 300));

    const { plaintext } = await jose.compactDecrypt(jwe, encPrivKey);
    const openid4vpResponse = JSON.parse(new TextDecoder().decode(plaintext));

    // Structural decode of the mdoc DeviceResponse to surface disclosed claims
    // (no trust verification — see mdoc.mjs).
    let disclosed = null;
    try {
      disclosed = decodeVpToken(openid4vpResponse.vp_token);
    } catch (e) {
      process.stderr.write(`[probe] (mdoc decode failed: ${e})\n`);
    }

    res.json({ received: true, disclosed });
    process.stderr.write(`\n[probe] ✓ PATH A (SIGNED) WORKS — encrypted vp_token returned through the page and decrypted\n`);
    process.stderr.write(`[probe] protocol: ${protocol}\n`);
    // transaction_data v3 signal: the round-trip completing AT ALL with transaction_data in
    // the request means the wallet accepted the payment binding (an unknown type or bad shape
    // throws "Unknown transaction type" and surfaces as a NetworkError). The wallet hashes the
    // base64url string; this is what it should have signed over.
    process.stderr.write(`[probe] transaction_data accepted — payee="${txData.payload.payee.name}" amount=${TX_AMOUNT} ${TX_CURRENCY}\n`);
    process.stderr.write(`[probe] expected transaction_data_hash (SHA-256 of the b64url string) = ${expectedTxHashB64url}\n`);
    if (disclosed) {
      for (const entry of disclosed) {
        process.stderr.write(`[probe]   credential: ${entry.type} (${entry.format})\n`);
        for (const c of entry.claims ?? []) {
          process.stderr.write(`[probe]     ${c.label} = ${JSON.stringify(c.value)}\n`);
        }
      }
    }
    process.stdout.write(JSON.stringify({ protocol, disclosed, vp_token: openid4vpResponse.vp_token }, null, 2) + "\n");
    setTimeout(() => process.exit(0), 200);
  } catch (e) {
    res.json({ received: true, decryptError: String(e) });
    process.stderr.write(`\n[probe] ✓ PATH A (SIGNED) round-trip SUCCEEDED — JWE returned through the page\n`);
    process.stderr.write(`[probe] ⚠ but server-side decrypt/parse failed: ${e}\n`);
    process.stderr.write(`[probe]   (the QR + wallet presentation worked; only our JWE decode tripped — fixable in Leg 2)\n`);
    process.stdout.write(JSON.stringify({ protocol, rawData: data }, null, 2) + "\n");
    setTimeout(() => process.exit(0), 200);
  }
});

const url = `${origin}/probe.html`;
process.stderr.write(
  `[probe] listening on ${origin}\n` +
  `[probe] reader cert SAN=localhost, client_id=x509_san_dns:localhost (self-signed, untrusted — expect a warning)\n` +
  `[probe] opening Chrome to ${url}\n` +
  `[probe] PREREQ: Chrome 141+, flag chrome://flags#web-identity-digital-credentials enabled,\n` +
  `[probe]         and a test mDL already provisioned in your Multipaz wallet.\n`
);
// Open Chrome specifically — the DC API + cross-device QR path needs Chrome 141+.
spawn("open", ["-a", "Google Chrome", url], { stdio: "ignore", detached: true }).unref();

setTimeout(() => {
  process.stderr.write(`[probe] timeout after ${TIMEOUT_MS}ms with no result\n`);
  process.exit(124);
}, TIMEOUT_MS);
