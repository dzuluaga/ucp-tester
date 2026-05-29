// Ad-hoc decoder: paste a base64url DeviceResponse (the vp_token value) and see
// the disclosed mDL fields — no phone dance, no trust verification.
//
//   node decode.mjs "<base64url-DeviceResponse>"
//   echo "<base64url-DeviceResponse>" | node decode.mjs
//
// Accepts either the raw DeviceResponse string, or a vp_token object/JSON like
//   {"mdl":"<base64url-DeviceResponse>"}

import { decodeDeviceResponse, decodeVpToken } from "./mdoc.mjs";

const arg = process.argv[2] ?? (await new Promise((r) => {
  let s = "";
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => r(s.trim()));
}));

if (!arg) {
  process.stderr.write("usage: node decode.mjs \"<base64url DeviceResponse>\"  (or pipe it on stdin)\n");
  process.exit(2);
}

let decoded;
const trimmed = arg.trim();
if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
  const parsed = JSON.parse(trimmed);
  const vp = parsed.vp_token ?? parsed; // accept full result or just the vp_token
  decoded = decodeVpToken(vp);
} else {
  decoded = [decodeDeviceResponse(trimmed)];
}

process.stdout.write(JSON.stringify(decoded, null, 2) + "\n");
