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
