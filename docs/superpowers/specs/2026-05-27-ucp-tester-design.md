# UCP Tester — PRD

**Author:** Diego Zuluaga
**Status:** Draft — circulating for feedback
**Created:** 2026-05-27
**Audience:** Anyone working on agentic commerce — UCP merchants, agent builders, payments folks, standards contributors

---

## TL;DR

Partner-led UCP integrations (Copilot, the Google-driven merchant work) are real signal. But a developer outside one of those white-glove engagements has no open, self-serve way to build and *test* a UCP workflow end-to-end. The closest thing — [ucpchecker.com](https://ucpchecker.com/) — is a closed compliance checker.

Other agentic ecosystems compounded once anyone could poke them:

| Ecosystem | Authoring | Driver | Validator |
|---|---|---|---|
| Web | HTML / JS / CSS | The browser | Source view, devtools, hit refresh |
| REST | OpenAPI / Swagger | cURL | Postman, Cypress |
| **UCP** | UCP spec | `ucp` CLI | **— missing** |

We propose **UCP Tester**: a Claude skill plus a portable scenario format that lets any developer exercise a UCP merchant end-to-end without a partner pipeline. Architecture is deliberately small — *YAML scenarios + a skill that drives the existing `ucp` CLI + pluggable, passkey-gated payment adapters.* No new transport, no parallel infrastructure, no MCP server on Day 1.

Goal of this PRD: rally collaborators around a sharp, tightly-scoped first deliverable.

---

## Try the Phase 0 demo

A working slice of this — passkey-gated authorization producing a mock AP2 Payment Mandate — is already runnable. In Claude Code:

```
> /plugin marketplace add dzuluaga/ucp-tester
> /plugin install ucp-agentic-tester@ucp-tester
> buy a flat white for $5
```

The browser opens, you complete Touch ID (or Windows Hello / hardware key), and a verified `ap2.PaymentMandate` appears in *both* the browser receipt card and as JSON in the terminal. Claude validates four gates (totals, authorization, expiry, subject binding) and reports.

Source: [`spike/passkey-gate/`](../../spike/passkey-gate/) (helper) and [`skills/agentic-purchase-gate/SKILL.md`](../../skills/agentic-purchase-gate/SKILL.md) (orchestration). Findings: [`spike/passkey-gate/FINDINGS.md`](../../spike/passkey-gate/FINDINGS.md).

---

## The Gap

A developer working on a UCP-enabled merchant today, outside a partner engagement, has no open way to answer:

- If a real buyer agent walks my flow, does it complete?
- Are my schemas correct? Do the operations I advertise match what I actually serve?
- Do my totals balance? Are required messages and disclosures rendered the way the spec demands?
- Does my escalation handoff actually work?
- Does my delegated-payment surface accept what an agent will send?

What exists today:

- **`ucpchecker.com`** — proprietary compliance checker, plus a merchant [directory](https://ucpchecker.com/directory). Useful, but closed and narrow.
- **`ucp` CLI** (Shopify, MIT) — the open buyer-flow driver. Drives any UCP merchant. Not a test runner — no scenarios, no assertions, no reports.
- **Partner pipelines** — hand-holding for high-value merchants. Does not scale to the long tail.

UCP has the spec and the driver. It does not yet have the Postman / Cypress equivalent. That gap is part of what's slowing broader developer adoption of agentic commerce — and it's the cheapest gap to close.

---

## What We're Building

A thin orchestration layer that:

1. **Reads scenarios** from YAML — portable, version-controllable, diff-friendly. Scenarios are the contribution surface.
2. **Drives the `ucp` CLI** through the scenario steps. No new transport, no parallel schema work.
3. **Asserts** on structured responses — status, schema conformance, totals balance, required messages, escalation handling.
4. **Reports** to Markdown for humans, with hooks for machine-readable output when CI demand emerges.

**Target developer experience:**

```
You: test this merchant — https://my-merchant.example.com

Claude (via UCP Tester skill):
  Running scenarios/happy-path.yaml against my-merchant.example.com…

  ✓ discover                       merchant advertises 9 operations
  ✓ catalog search                 query="widgets", 8 products returned
  ✓ cart create                    id=cart_abc · 1 line item · USD
  ✓ checkout create from cart     status=incomplete
  ✓ checkout update destination   2 fulfillment options returned
  ✓ checkout update selection     totals balance (lines + tax + ship = total)
  ◐ passkey gate                  awaiting user verification… ✓ verified
  ✓ checkout complete (Stripe test) status=completed · order=ord_xyz
  ✓ order get                      fulfillment=processing

  PASSED · 8 steps · 14 assertions · 1 passkey ceremony
  Full report: reports/2026-05-27-happy-path.md
```

Same scenario, same skill, in any Claude surface (Claude Code, claude.ai, IDEs). Cloneable repo, runs on a laptop, no partner gate.

---

## Architecture — Simple and Elegant

```
        scenarios/*.yaml          ← single source of truth
                │                    (the contribution surface)
                ▼
        ┌────────────────┐
        │  UCP Tester    │         ← Claude skill (P1)
        │  (skill)       │           reads scenario, asserts, reports
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │   ucp  CLI     │         ← Shopify's MIT buyer driver
        │  (Shopify)     │           merchant-agnostic, already exists
        └───────┬────────┘
                │ UCP over HTTP
                ▼
        ┌──────────────────────┐
        │ Merchant under test  │
        └──────────────────────┘

  Payment step pluggable via adapter (each adapter can opt into a passkey gate):
    Stripe test tokens (P1)  |  AP2 Mandates (later)  |  x402 (later)  |  mock vault (CI)
```

Three rules keep this honest:

1. **Skill first; defer everything else.** A standalone CLI runner, an MCP server wrapping the runner, a hosted web UI — all defensible, none Day-1. The YAML scenarios make each of them cheap to add later *if* pull emerges. Building them up front is the trap.
2. **No new transport, no new schema.** Everything UCP-level goes through the `ucp` CLI. The tester is value-add on top, not a parallel stack.
3. **One scenario format, however many runners.** Whatever runs the YAML — skill today, CLI tomorrow, MCP someday — must run *the same* YAML. No drift, no double-maintenance.

### Why a skill, not an MCP server, not a custom agent

- **Skill** gives us the fastest path to "any developer with Claude can test a UCP merchant." Zero new infra. Composes with the existing `shopify-plugin:ucp` skill that already drives the CLI.
- **Standalone agent** (custom orchestration loop, prompt management, tool wiring) is real work and a permanent maintenance surface. Not warranted while a skill can do the job.
- **MCP server** wrapping the runner is the right answer *if and when* Cursor / Copilot / Gemini developers want the same tester. That's a P3+ question. Wrapping UCP endpoints themselves is unnecessary — UCP endpoints already exist; we don't need to re-expose them.

### Payments and authorization

Payment is a pluggable adapter interface from Day 1 — a small surface (authorize, capture, status). Phase 1 ships one concrete adapter:

| Adapter | Phase | Why |
|---|---|---|
| **Stripe test tokens** | P1 | Mirrors how merchants already think about "test mode." No new infra. |
| **Mock vault** | P1 (optional) | Deterministic for CI; no PSP required. |
| **AP2 Mandates** | Later | Intent → Cart → Payment Mandate. Google-led. First-class peer, not retrofit. |
| **x402** | Later | HTTP-native payment protocol. OMH-aligned. |

The adapter interface existing on Day 1 is what keeps AP2 and x402 from becoming bolt-ons.

**Passkey-gated authorization (P1 target, pending the Phase 0 spike).**

Every adapter can opt into a WebAuthn passkey ceremony before authorize/capture. The passkey isn't signing the payment itself — it's gating release of the signing key (or, in mock mode, gating the dev signer). Concretely:

- **Stripe test tokens** — passkey unlocks the test publishable key + triggers the charge.
- **Mock AP2 / mock x402** — passkey ceremony proves user presence + hardware verification; on success, a dev signer emits a structurally-correct (but cryptographically mock) AP2 Mandate chain or x402 payment header. The *UX* and the "no agent transacts without a hardware-verified human gesture" property are real even though the crypto is mock.
- **Promotion path to real DPC / Multipaz** — when the production credentials arrive, the same passkey gate fronts a Secure Enclave / StrongBox key (via Multipaz) that signs the real AP2 mandate or x402 payment. The scenario YAML and the gate stay identical; only the adapter internals change.

This gives the tester something the rest of the toolchain hasn't shown yet: a realistic, demonstrable answer to "who authorizes the agent?" — using hardware every developer already has, on Day 1, without shipping production credential stacks.

**How the gate is implemented (P1).** Claude does not — and cannot — touch the secure element directly. WebAuthn ceremonies are hard-gated by OS-level user presence + user verification; that's the whole security property. Instead the skill spawns a tiny local helper: an ephemeral web server on `localhost:<port>`, opens the default browser (`open` / `xdg-open` / `start`) to a `/gate` page, the page runs `navigator.credentials.get()`, the browser invokes the platform passkey UI (Touch ID, Windows Hello, Android biometric, hardware key), and the resulting assertion is POSTed back to the local server and surfaced to the adapter. Mobile phones can complete the same ceremony by hitting the local URL from their browser, using StrongBox / Secure Enclave on the device. For CI and headless runs, the same flow uses Chrome DevTools Protocol's virtual authenticator (`WebAuthn.addVirtualAuthenticator`) — deterministic, no hardware required, same scenario YAML. The helper is small (~a few hundred lines), pure web standards, no MCP server required for this; MCP only earns its keep when the broader runner moves cross-host (P4).

---

## Demo modalities — "who authorizes the agent?"

The passkey gate is the same conceptual slot across many credential-presentation flows. Each is a self-contained story we can showcase as its own video. The arc runs from *real-but-mocked today* → *automatable* → *cross-device* → *real payment rails* → *the credential-presentation future*.

| # | Modality | What it demonstrates | What flows back | Maturity | Demo cost |
|---|---|---|---|---|---|
| 1 | **Local platform passkey gate** (Touch ID / Windows Hello / hardware key) | "Buy a flat white for $5" → browser → biometric → verified `ap2.PaymentMandate` in receipt card + terminal JSON → 4 gates validated | Signed WebAuthn assertion releasing the (mock) signing key | **Shipping now** (macOS validated; Windows Hello & roaming hardware key are variants) | **Zero** — already built (the Phase 0 spike) |
| 2 | **CI / headless virtual authenticator** | The *identical* scenario YAML running with no human and no hardware. "Same test, green in CI." | Synthetic but structurally-real assertion | Standard CDP `WebAuthn.addVirtualAuthenticator`, reliable | **Low** — wire the virtual-authenticator leg |
| 3 | **Cross-device FIDO hybrid (caBLE)** | Desktop renders a QR, scan with phone, BLE proximity check, phone's passkey completes the ceremony | Passkey assertion from the phone's Secure Enclave / StrongBox | Shipping widely in browsers today | **Medium** — browser-native, mostly UX plumbing |
| 4 | **Payment Request API + Apple Pay / Google Pay** | Presenting an *existing* wallet card → Face/Touch ID → network-tokenized payment (never the PAN) | DPAN + cryptogram (a payment token, not a passkey assertion) | Production today | **Google Pay TEST = light** (good first pick); **Apple Pay = heavy** (merchant ID + domain verification) |
| 5 | **Digital Credentials API cross-device** (mDL / VC / DPC) | Verifier site renders a QR → Android camera → wallet presents a credential (aspirationally a Digital Payment Credential = card-as-credential) via OpenID4VP / ISO 18013-5 | Presented, selectively-disclosed credential, BLE-proximity-bound | Emerging; payment (DPC) is issuer-gated, earliest-stage | **High** — the "where this is going" video |
| 6 | **Same ceremony, phone over Wi-Fi** | Phone hits the local helper URL directly on the LAN and runs the *same* WebAuthn ceremony against StrongBox / Secure Enclave | Same as #1, authored on the phone | Trivial extension of the spike | **Low** — a mobile cut of #1 without QR/caBLE |

**Constraint that holds across all six:** Claude never touches the secure element directly, and secure-element keys/PANs are non-extractable. Every modality presents or *uses* a credential with a hardware-verified human gesture; none reads a key or card number out. In the spike the crypto is mock (MOCK-DEV-SIGNER), no money moves, and no real merchant is contacted — only the ceremony and the artifact's structural shape are real.

Two modalities are free right now (#1, #6), two are low-lift (#2, #3), #4 is the real-money-rails story, and #5 is the visionary one.

---

## Phased Roadmap

**Phase 0 — Passkey-gate feasibility spike.** *Status: macOS leg ✓, demo skill shipped as Claude Code plugin · CI leg pending · spot-check pending.*

The riskiest assumption in this PRD was *"a Claude skill can drive a real WebAuthn ceremony end-to-end via a local helper and receive the assertion back."* Phase 0 validated it for the macOS surface and went further: the demo emits a structurally-AP2-shaped Payment Mandate (mock crypto, real ceremony) and runs from a natural-language purchase intent typed into Claude Code.

What was built and validated:

- Local helper at `spike/passkey-gate/` (Node + Express + `@simplewebauthn/server`). Ephemeral web server, `/gate` page running registration + authentication ceremonies, server-side signature verification, mandate emission.
- `agentic-purchase-gate` Claude skill at `skills/agentic-purchase-gate/SKILL.md`. Parses intent ("buy X for $Y"), invokes the helper, validates four gates (totals match, hardware-backed user verification, expiry window, subject binding), reports.
- Demo packaged as a Claude Code plugin (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, name `ucp-agentic-tester`), installable once published via `/plugin marketplace add dzuluaga/ucp-tester` then `/plugin install ucp-agentic-tester@ucp-tester`.
- Validated repeatedly on macOS Touch ID (6+ successful runs, multiple distinct purchase intents). Same canonical Payment Mandate rendered in both the browser receipt UI and the terminal JSON per ceremony.

**Still open before Phase 0 is fully closed:**

- **CI virtual-authenticator leg** — same helper driven by a Playwright script using Chrome DevTools Protocol's `WebAuthn.addVirtualAuthenticator`. Required exit criterion.
- **Spot-check** on one of: Windows Hello, or Android over Wi-Fi (mobile passkey via StrongBox).

The macOS leg alone is enough to consider *technical feasibility settled*. The remaining items harden the case; they don't reopen it.

**Phase 1 — Skill + happy-path scenario + passkey gate.** *Target: weeks, not months.*
- YAML scenario format spec, plus reference `scenarios/happy-path.yaml`
- Claude skill that drives `ucp` CLI through the scenario, asserts, emits Markdown report
- Stripe test-token payment adapter
- Optional passkey gate on the adapter (WebAuthn ceremony before authorize/capture)
- Works against any UCP endpoint by URL

**Phase 2 — Sandbox merchant.**
- Tiny reference UCP-implementing merchant in the same repo
- "Clone, run, see green" experience without owning a merchant yet
- Used as smoke target in our own CI

**Phase 3 — Headless CLI runner (only if CI demand pulls it).**
- Standalone runner that executes the *same* YAML scenarios as the skill
- Machine-readable output (JUnit XML / JSON) for GitHub Actions, etc.
- Headless passkey mode (deterministic test authenticator) so passkey-gated scenarios still run in CI

**Phase 4 — MCP surface (only if multi-host demand pulls it).**
- MCP server wrapping the runner so any AI host can drive the tester

**Phase 5 — Depth.**
- Edge / fuzz scenarios (malformed carts, expired sessions, escalation paths, multi-merchant baskets)
- Spec compliance assertions (totals contract, messages contract, disclosure rendering, minor-units handling)
- **AP2 Mandate** and **x402** payment adapters (real signing)
- **DPC + Multipaz** integration — the passkey gate fronts a real hardware-backed credential, not a mock signer
- Localization and regional variations

---

## Non-Goals

- **Not a compliance certifier.** `ucpchecker.com` and standards bodies own that lane.
- **Not a buyer agent.** The `ucp` CLI and partner buyer agents own that lane.
- **Not a UCP server framework.** The sandbox merchant is a teaching artifact, not Rails-for-UCP.
- **Not a payments processor.** Adapters integrate with existing rails; the tester does not move money.
- **Not a credential issuer.** Passkeys and mock signers are for *testing authorization flow*; production credentials come from DPC / Multipaz / partner issuers.

---

## Open Questions

We are explicitly leaving these open so collaborators can weigh in:

- **Repo home.** Standalone community repo to start, then donate to Universal-Commerce-Protocol org or OpenMobileHub as traction emerges — what's the right call?
- **Scenario format ownership.** Should the YAML schema be proposed as part of a UCP standards profile, or remain a tool-level convention?
- **Sandbox merchant location.** Same repo, peer repo, or external reference?
- **Hosted "paste-a-URL" web UI**, or strictly local-first?
- **AP2 adapter scope.** Intent + Cart + Payment Mandate as a single adapter, or staged sub-adapters?
- ~~**Passkey scope in P1.**~~ **Resolved (Phase 0).** Ship the passkey gate in P1. The demo is already runnable as the `agentic-purchase-gate` skill of the `ucp-agentic-tester` plugin; the promotion path to real DPC + Multipaz in P5 is unchanged.

---

## Call to Collaborate

We are rallying around a small, sharp first deliverable. Specifically asking for:

1. **Feedback on this PRD** — especially from anyone who has tried to test a UCP integration without a partner pipeline.
2. **Early merchant testers** — teams willing to point the Phase 1 skill at a staging endpoint and tell us what broke.
3. **Scenario contributors** — even one well-written edge-case YAML is a meaningful contribution.
4. **AP2 and x402 design partners** for the Phase 5 payment adapters.
5. **Passkey / WebAuthn folks** willing to pressure-test the passkey-gated adapter design — especially the promotion path to DPC / Multipaz.
6. **Anyone working on something adjacent**, so we don't duplicate.

If you have thought about this gap, are building something nearby, or want to push back on the framing — please respond.
