import express from "express";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RP_NAME = "UCP Tester Passkey Spike";
const RP_ID = "localhost";
const USER_ID = new Uint8Array(randomBytes(16));
const USER_NAME = "spike-user";
const TIMEOUT_MS = 120_000;

const session = {
  expectedChallenge: null,
  credential: null,
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));
app.use("/lib/sw", express.static(join(__dirname, "node_modules/@simplewebauthn/browser/esm")));

const port = await new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const origin = `http://localhost:${port}`;

app.get("/register/options", async (_req, res) => {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: USER_ID,
    userName: USER_NAME,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  session.expectedChallenge = options.challenge;
  res.json(options);
});

app.post("/register/verify", async (req, res) => {
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: session.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified) return res.status(400).json({ error: "registration not verified" });
    session.credential = verification.registrationInfo.credential;
    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/authenticate/options", async (_req, res) => {
  if (!session.credential) return res.status(400).json({ error: "no credential registered yet" });
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: [{ id: session.credential.id, transports: ["internal", "hybrid"] }],
    userVerification: "required",
  });
  session.expectedChallenge = options.challenge;
  res.json(options);
});

app.post("/authenticate/verify", async (req, res) => {
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: session.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: RP_ID,
      credential: session.credential,
      requireUserVerification: true,
    });

    const result = {
      verified: verification.verified,
      authenticatorInfo: verification.authenticationInfo,
      origin,
      rpID: RP_ID,
      timestamp: new Date().toISOString(),
    };

    res.json(result);

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    setTimeout(() => process.exit(verification.verified ? 0 : 1), 200);
  } catch (err) {
    res.status(400).json({ error: err.message });
    setTimeout(() => process.exit(2), 200);
  }
});

const url = `${origin}/gate.html`;
process.stderr.write(`[spike] listening on ${origin}\n[spike] opening ${url}\n`);
spawn("open", [url], { stdio: "ignore", detached: true }).unref();

setTimeout(() => {
  process.stderr.write(`[spike] timeout after ${TIMEOUT_MS}ms with no completed ceremony\n`);
  process.exit(124);
}, TIMEOUT_MS);
