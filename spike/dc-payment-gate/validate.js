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
  let results;
  try {
    results = await runGates(mandate);
  } catch (e) {
    process.stderr.write(`[gate] ✗ could not evaluate gates (malformed mandate): ${e}\n`);
    process.stdout.write(JSON.stringify({ authorized: false, error: String(e), mandate }, null, 2) + "\n");
    process.exit(1);
  }
  let allPass = true;
  for (const r of results) { allPass = allPass && r.pass; process.stderr.write(`[gate] ${r.pass ? "✓" : "✗"} ${r.gate} — ${r.detail}\n`); }
  process.stdout.write(JSON.stringify({ authorized: allPass, gates: results, mandate }, null, 2) + "\n");
  process.exit(allPass ? 0 : 1);
}
