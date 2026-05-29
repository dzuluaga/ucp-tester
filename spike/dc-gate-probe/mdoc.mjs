// Structural-only decode of presented credentials to read the disclosed claims.
// Handles BOTH mdoc DeviceResponse (ISO 18013-5, CBOR) and SD-JWT VC (e.g. the
// EMVCo Digital Payment Credential, vct urn:emvco:dpc:card:1). NO trust verification
// — does NOT check issuer/device signatures, digests, or the SD-JWT signature/key
// binding. It just surfaces what the wallet disclosed. Real cryptographic validation
// (@auth0/mdl for mdoc, an SD-JWT verifier) is a Leg 2 concern.

import { decode, Tag } from "cbor-x";

function b64urlToBytes(s) {
  return new Uint8Array(Buffer.from(String(s), "base64url"));
}

// IssuerSignedItemBytes = #6.24(bstr .cbor IssuerSignedItem). Depending on the
// cbor-x build, tag 24 arrives either as a Tag wrapping bytes or already as bytes.
function decodeIssuerSignedItem(item) {
  if (item instanceof Tag) return decode(item.value);
  if (item instanceof Uint8Array) return decode(item);
  return item; // already decoded
}

// Make values printable: bytes → base64url, Tag → {tag,value}, BigInt/Date readable.
function sanitize(v) {
  if (v instanceof Uint8Array) return { _bytes_b64url: Buffer.from(v).toString("base64url") };
  if (v instanceof Tag) return { _tag: v.tag, value: sanitize(v.value) };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = sanitize(val);
    return o;
  }
  return v;
}

// Returns { version, status, documents: [{ docType, claims: { ns: { element: value } } }] }.
export function decodeDeviceResponse(vpTokenB64url) {
  const dr = decode(b64urlToBytes(vpTokenB64url));
  const out = { version: dr.version, status: dr.status, documents: [] };
  for (const doc of dr.documents ?? []) {
    const docOut = { docType: doc.docType, claims: {} };
    const nameSpaces = doc.issuerSigned?.nameSpaces ?? {};
    for (const [ns, items] of Object.entries(nameSpaces)) {
      docOut.claims[ns] = {};
      for (const raw of items) {
        const isi = decodeIssuerSignedItem(raw);
        docOut.claims[ns][isi.elementIdentifier] = sanitize(isi.elementValue);
      }
    }
    out.documents.push(docOut);
  }
  return out;
}

// Structural decode of an SD-JWT VC presentation: "<JWT>~<disclosure>~...~[<KB-JWT>]".
// Returns { vct, claims: { name: value } }. Disclosures are base64url JSON arrays
// [salt, name, value]; the optional trailing Key-Binding JWT (has dots) is skipped.
function decodeSdJwt(token) {
  const parts = token.split("~");
  const [, payloadB64] = parts[0].split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

  const skip = new Set(["_sd", "_sd_alg", "cnf", "iss", "iat", "exp", "nbf", "status"]);
  const claims = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!skip.has(k)) claims[k] = v;
  }
  for (const d of parts.slice(1)) {
    if (!d) continue;
    try {
      const arr = JSON.parse(Buffer.from(d, "base64url").toString());
      if (Array.isArray(arr) && arr.length >= 3) claims[arr[1]] = arr[2]; // [salt, name, value]
    } catch { /* trailing KB-JWT or non-disclosure — ignore */ }
  }
  return { vct: payload.vct, claims };
}

// vp_token from OpenID4VP DC API: { "<dcql-id>": "<presented credential>" } (older
// shape: an array). Each value is either a base64url mdoc DeviceResponse (no dots) or
// an SD-JWT string (contains dots). Returns a uniform, flattened shape for display:
//   [{ id, format, type, claims: [{ label, value }] }]
export function decodeVpToken(vpToken) {
  const entries = Array.isArray(vpToken)
    ? vpToken.map((v, i) => [String(i), v])
    : Object.entries(vpToken ?? {});

  return entries.map(([id, token]) => {
    if (typeof token === "string" && token.includes(".")) {
      const { vct, claims } = decodeSdJwt(token);
      return {
        id, format: "dc+sd-jwt", type: vct,
        claims: Object.entries(claims).map(([label, value]) => ({ label, value })),
      };
    }
    const dr = decodeDeviceResponse(token);
    const flat = [];
    let type;
    for (const doc of dr.documents) {
      type = doc.docType;
      for (const [ns, els] of Object.entries(doc.claims)) {
        for (const [el, value] of Object.entries(els)) flat.push({ label: `${ns} / ${el}`, value });
      }
    }
    return { id, format: "mso_mdoc", type, claims: flat };
  });
}
