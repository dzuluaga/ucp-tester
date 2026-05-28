#!/usr/bin/env node
// Mock AP2 adapter — banner printer + structure validator for the spike.
//
// Reads an ap2.PaymentMandate JSON from stdin (the gate's stdout), validates
// the expected fields are present, prints a one-line summary banner to stderr
// (for the human watching the terminal), and passes the mandate through to
// stdout unchanged (for the skill / downstream consumer).
//
// In production this stage is where the *real* cryptography would happen —
// the gate would emit only an assertion, and this adapter would sign a real
// AP2 SD-JWT Payment Mandate. For the spike we collapsed mandate construction
// into the gate so the browser and terminal can show the same mandate object.

const readStdin = () =>
  new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });

const raw = await readStdin();
let mandate;
try {
  mandate = JSON.parse(raw);
} catch (err) {
  process.stderr.write("[mock-ap2-adapter] could not parse gate output as JSON\n");
  process.stderr.write(raw + "\n");
  process.exit(2);
}

const required = ["type", "id", "cart", "payment", "userAuthorization", "signature"];
const missing = required.filter((k) => !(k in mandate));
if (missing.length > 0) {
  process.stderr.write(`[mock-ap2-adapter] mandate missing required fields: ${missing.join(", ")}\n`);
  process.exit(3);
}
if (mandate.type !== "ap2.PaymentMandate") {
  process.stderr.write(`[mock-ap2-adapter] expected type=ap2.PaymentMandate, got ${mandate.type}\n`);
  process.exit(4);
}
if (!mandate.userAuthorization?.verified) {
  process.stderr.write("[mock-ap2-adapter] refusing to forward: userAuthorization.verified is not true\n");
  process.exit(5);
}

const banner = [
  "",
  "═══════════════════════════════════════════════════════════════════════",
  `  ✓ ${mandate.type} · $${mandate.payment.amount} ${mandate.payment.currency} · ${mandate.cart.merchant.id}`,
  `  ✓ userAuthorization: webauthn · hardware-backed · userVerified=${mandate.userAuthorization.userVerified}`,
  "═══════════════════════════════════════════════════════════════════════",
  "",
].join("\n");
process.stderr.write(banner);
process.stdout.write(JSON.stringify(mandate, null, 2) + "\n");
