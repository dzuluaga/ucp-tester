// test/validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { runGates } from "../validate.js";
import { makeConsistentMandate, buildVpToken } from "./fixtures.mjs";

const pass = (results, gate) => results.find((r) => r.gate === gate)?.pass;

test("all 4 gates pass for a consistent mandate", async () => {
  const { mandate } = await makeConsistentMandate();
  const results = await runGates(mandate);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.pass), JSON.stringify(results, null, 2));
});

test("gate 1 fails when cart.total is tampered", async () => {
  const { mandate } = await makeConsistentMandate();
  mandate.cart.totals.total = "999.00";
  const results = await runGates(mandate);
  assert.equal(pass(results, "Amount binding"), false);
  assert.equal(pass(results, "Subject binding"), true); // others unaffected
});

test("gate 2 fails when deviceAuth is stripped", async () => {
  const { mandate, ctx } = await makeConsistentMandate();
  mandate.userAuthorization.vpToken = buildVpToken({ txHashBytes: ctx.hashBytes, omitDeviceAuth: true });
  const results = await runGates(mandate);
  assert.equal(pass(results, "Authorization present"), false);
  assert.equal(pass(results, "Amount binding"), true); // hash still matches
});

test("gate 3 fails when the credential is expired", async () => {
  const { mandate, ctx } = await makeConsistentMandate();
  mandate.userAuthorization.vpToken = buildVpToken({ txHashBytes: ctx.hashBytes, expiry: "2020-01-01" });
  const results = await runGates(mandate);
  assert.equal(pass(results, "Credential not expired"), false);
});

test("gate 4 fails when subject does not match the disclosed instrument", async () => {
  const { mandate } = await makeConsistentMandate();
  mandate.subject.credentialId = "pi-DIFFERENT";
  const results = await runGates(mandate);
  assert.equal(pass(results, "Subject binding"), false);
  assert.equal(pass(results, "Amount binding"), true);
});

test("runGates throws on a non-decodable vpToken (CLI catches and fails closed)", async () => {
  const { mandate } = await makeConsistentMandate();
  mandate.userAuthorization.vpToken = "!!!not-valid-base64url-cbor!!!";
  await assert.rejects(() => runGates(mandate));
});
