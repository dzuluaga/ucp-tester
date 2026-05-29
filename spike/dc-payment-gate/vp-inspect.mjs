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
