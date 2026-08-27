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
- Phase 2 (policy gate):
- Phase 3 (thin portal, write path):
- Phase 4 (day-2: drift + decommission):
- Phase 5 (visibility & metrics — the headline): _did the oversight/metrics feel valuable? what was missing?_

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
