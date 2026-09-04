# IDP Prototype — Guided Walkthrough

A step-by-step tour of the whole platform, capturing what each part does, how to run it, and
**why it matters**. Each page has a screenshot placeholder — run the step, drop the image into
`images/`, and the caption is already written.

## What this platform is (one paragraph)

A hands-on Internal Developer Platform prototype whose first capability is **developer
self-service for a GCS bucket**: a thin portal → a GitOps PR → policy-gated Terraform → a real,
compliant bucket via **keyless** auth — plus day-2 drift/decommission and an oversight dashboard.
The durable investment is the **portal-agnostic `idp-gitops` backend**; the portal is thin and
disposable. See [PRD.md](../../PRD.md), [CLAUDE.md](../../CLAUDE.md), and the learnings log
[EVALUATION.md](../../EVALUATION.md).

## Architecture at a glance

```
 developer ──form──▶ idp-portal ──opens PR──▶ idp-gitops (GitHub)
                                                  │
                     pr.yml: fmt/validate/plan ──▶ policy gate (Conftest) ──▶ plan comment
                                                  │ merge
                     apply.yml ──WIF (keyless)──▶ GCP: compliant GCS bucket + audit comment
                                                  │
   drift.yml (scheduled) ─plan all─▶ Drift Issue      metadata.yaml ─▶ /dashboard (oversight)
   destroy.yml (on stack removal) ─▶ terraform destroy
```

## The tour

1. [Foundations — project, keyless WIF, state, CI](01-foundations.md)
2. [The golden-path module & its guardrail tests](02-golden-path-module.md)
3. [Request a bucket via the portal (write path)](03-request-via-portal.md)
4. [PR CI — plan + the policy gate](04-pr-plan-and-policy-gate.md)
5. [Merge → apply via WIF + the audit trail](05-apply-and-audit.md)
6. [The oversight dashboard](06-oversight-dashboard.md)
7. [Day-2 — drift detection & decommission](07-day2-drift-and-decommission.md)

## Prerequisites for the capture pass

- **Tools:** `node` ≥ 20, `terraform`, `gcloud` (with Application Default Credentials:
  `gcloud auth application-default login`), `gh`; and for local checks `tflint`, `trivy`,
  `conftest`.
- **Portal env:** a `.env` at repo root (gitignored) with a fine-grained `GITHUB_TOKEN`
  (Contents + Pull requests: read/write on `edoatley/idp-prototype`). Set
  `GITHUB_REPO=edoatley/idp-prototype` when running the portal.
- **Repo state:** only `edo-dev-payments-discounts` is live right now (`platform-demo` was
  decommissioned in #41); earlier demo buckets were decommissioned too. Steps needing a fresh artifact offer both **"re-run to capture"** and a
  **reference permalink** to the original PR/run.

## How to use this guide

For each step: **Do this** (run the command / open the link) → screenshot → save it to
`docs/walkthrough/images/` with the filename shown in the placeholder → the surrounding
narrative is already written. Commit images as you go.

> Screenshots are captured by a human (the GCP console, GitHub UI, and the local portal aren't
> scriptable here). The commands, links and explanations are pre-filled.
