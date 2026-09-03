# 4 — PR CI: plan + the policy gate

*(Phases 1–2 — `.github/workflows/pr.yml` + `idp-gitops/policy/`)*

Every request is an auditable PR. On open, CI plans the change and runs an **independent policy
gate** before anyone merges.

## Do this

Open the PR from step 3 (or any stack PR) and look at:

- **Checks**: `detect`, `plan (…stack…)`, plus `terraform-checks` and `policy`.
- The **sticky comment** from `pr.yml`: a `Terraform plan` section and a **`Policy gate — ✅ PASS`**
  section showing the conftest output.

Then see the gate **block** a bad change — open the deliberately non-compliant demo PR
[#14](https://github.com/edoatley/idp-prototype/pull/14): its `plan` check is **red** and the
comment shows **`Policy gate — ❌ FAIL`** with the denials.

## What's happening & why

`pr.yml` authenticates with **keyless WIF** (plan still needs it — the GCS backend reads state),
runs `fmt`/`validate`/`plan`, exports the plan as JSON, and feeds it to **Conftest**. The Rego
policies re-check every guardrail (public access, UBLA, versioning, region, labels, name) — so a
stack that bypasses the module by calling the raw resource is **still caught**. Module = *prevent*;
policy gate = *detect*. A deny fails the job → the PR can't merge. The result is posted on the PR,
so reviewers see *why*.

![PR checks + the plan/policy-gate sticky comment (PASS)](images/04-pr-plan-pass.png)

![PR #14 — Policy gate ❌ FAIL blocking a public bucket, with the denials](images/04-policy-gate-fail.png)

## Reference links

- Workflow: [`pr.yml`](../../.github/workflows/pr.yml) · Policies: [`policy/`](../../idp-gitops/policy/README.md)
- PRs: [#9 pr/apply workflows](https://github.com/edoatley/idp-prototype/pull/9),
  [#12 policy gate](https://github.com/edoatley/idp-prototype/pull/12),
  [#13 gate enforced in pr.yml](https://github.com/edoatley/idp-prototype/pull/13),
  [#14 blocked demo](https://github.com/edoatley/idp-prototype/pull/14)

---
Next: [5 — Merge → apply via WIF + audit →](05-apply-and-audit.md)
