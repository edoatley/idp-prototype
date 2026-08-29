# Learnings & Evaluation

Primary goal of the prototype is to **experience IDP value and its component parts** (see
[PRD.md](./PRD.md)). This file has two jobs:

1. A **running learnings log** captured *while building* — what an IDP gives you, and how
   Terraform + GitOps + a thin portal feel to build and operate.
2. A **Phase 6 comparison**: Backstage vs the thin custom portal, once the lightweight
   prototype has proved the value.

## Part 1 — Running learnings (capture as you go)

For each phase, note: what worked, friction/surprises, time spent, and — most importantly —
*where you felt the IDP delivering value* (golden path, guardrails, visibility, day-2).

- Phase 0 (GCP + WIF + state):
- Phase 1 (Terraform golden path + GitOps):
  - **It worked end to end, first try on live infra.** A hand-written PR planned +
    commented via `pr.yml`, and on merge `apply.yml` provisioned `edo-dev-platform-demo`
    through keyless WIF (the Phase 0 smoke test we deferred to here) — UBLA,
    public-access-prevention=enforced, versioning, multipart-abort lifecycle and all four
    mandatory labels, with state isolated under its own prefix.
  - **Where the value landed:** (1) the guardrailed module makes the safe config the *only*
    config — the developer picks 3 fields, everything else is non-overridable; (2) the PR
    **plan comment** gives visibility before merge; (3) `metadata.yaml` as the inventory
    record — the seed of the Phase 5 oversight story. The Terraform+GitOps backend really is
    portal-agnostic: nothing here assumes a portal.
  - **Terraform gotchas worth remembering:** validating `owning_team` against `teams.yaml`
    can't be done in a variable `validation` block (self-contained only) — needed a resource
    `precondition` reading the file. In tests, `lifecycle_rule`/`action`/`condition` are
    *sets*, not lists (no `[0]` indexing — use `one()`).
  - **CI/testing:** `mock_provider` unit tests keep guardrails honest with no cloud/creds;
    adding `trivy` beside `tflint` gave a security baseline (4 findings triaged as documented
    exceptions). A review catch — the multipart-abort rule was enforced but untested —
    reinforced "every guardrail needs a matching assertion."
  - **Friction:** workflow change-detection needed care (push `before` all-zero SHA, `set -e`
    with `&&`); couldn't run `actionlint` locally (sandbox blocked its installer), so relied
    on YAML parse + hand review. Delivered as 4 small PRs (#7 module, #8 security scanning,
    #9 workflows, #10 first stack) — reviewable, but sequencing mattered (workflows had to be
    on `main` before the stack PR could exercise them).
- Phase 2 (policy gate):
- Phase 3 (thin portal, write path):
- Phase 4 (day-2: drift + decommission):
- Phase 5 (visibility & metrics — the headline): _did the oversight/metrics feel valuable? what was missing?_

### Security-scanning backlog (accepted trivy exceptions)

Phase 1 added local + CI security scanning (`trivy config`, alongside `tflint`). The
findings below are recorded as **deliberate, documented exceptions** in `.trivyignore`
(scans stay green; any *new* finding fails CI). Revisit as the prototype hardens:

- **GCP-0010 (HIGH) — default network at project level.** `auto_create_network` is
  create-time only, so it can't be flipped on the live project; real fix is deleting the
  existing default network out of band. No compute/ingress uses it today.
- **GCP-0077 (MEDIUM) — state-bucket access logging.** Needs a separate log-sink bucket;
  fold into Phase 5 centralised visibility/audit.
- **GCP-0066 (LOW) — CMEK.** Google-managed encryption is sufficient for the prototype;
  CMEK would add a KMS key ring + IAM to Phase 0.
- **GCP-0079 (LOW) — project IAM data-access audit logging.** Out of scope for a single
  throwaway project; admin-activity logs are on by default.

## Part 2 — Backstage vs thin portal (Phase 6)

Re-implement the golden path on Backstage against the **unchanged** `idp-gitops` backend,
then score 1–5 (5 = best) with evidence:

| Criterion | Thin custom portal | Backstage | Notes / evidence |
|---|---|---|---|
| Setup / onboarding cost | | | |
| Developer DX (consumer) | | | |
| Platform-engineer DX (author/maintain) | | | |
| Extensibility (adding a capability) | | | |
| Catalog / inventory + ownership | | | |
| Visibility / metrics support | | | |
| Guardrail / policy integration | | | |
| Maintenance & upgrade burden | | | |
| Docs & community | | | |
| Fit for *our* org | | | |

_Because the Terraform + GitOps backend is portal-agnostic, this comparison isolates the
**portal** variable — the backend investment carries across either choice._

## Alternatives considered (documented, not built)
- **Portal:** Port, Cortex — off-the-shelf lightweight IDPs — why / why not for us.
- **Provisioning:** Pulumi, Crossplane / Config Connector — why / why not for us.

## Recommendation
_To be written in Phase 6: thin portal vs Backstage for our org, with the top 3 reasons._
