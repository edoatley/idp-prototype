# CLAUDE.md

Guidance for working in this repository. See [PRD.md](./PRD.md) for the full design and
[EVALUATION.md](./EVALUATION.md) for the running learnings log.

## What this is

A hands-on prototype to **experience the value and component parts of an Internal Developer
Platform (IDP)** — with particular focus on how an IDP delivers **oversight, visibility and
metrics**. The first capability is developer self-service for a **GCS bucket**: a thin custom
portal → a GitOps PR → Terraform apply → a real, compliant bucket, plus a dashboard over what
exists, who owns it, how the platform performs, and whether things stay compliant.

Guiding principles:
- **Thin custom portal first**, Backstage evaluated/migrated later (Phase 6).
- **Terraform + GitHub GitOps backend is portal-agnostic** — the durable investment.
- **Minimal, opinionated golden path**: the platform enforces the safe defaults; devs pick very little.
- **Keyless** GCP auth (Workload Identity Federation); no long-lived service-account keys, ever.

## Repository structure

```
PRD.md, EVALUATION.md, CLAUDE.md   # design, learnings, this guide
idp-bootstrap/     # Phase 0: one-time GCP + CI foundations (LOCAL state on purpose)
idp-gitops/        # portal-agnostic source of truth
  platform/        # shared conventions: config.yaml (org/region/envs), teams.yaml
  modules/         # opinionated, guardrailed Terraform modules (Phase 1+)
  stacks/          # per-request Terraform stacks (generated), each with its own state prefix
  policy/          # Rego policies for the Conftest gate (Phase 2)
  .github/workflows/  # pr / apply / drift / destroy pipelines
idp-portal/        # thin custom app: create-bucket form (write) + visibility dashboard (read)
```

## Phases

- **Phase 0 — GCP + CI foundations** *(in progress)*. `idp-bootstrap`: standalone project
  `idp-prototype-edo`, APIs, hardened GCS state bucket, WIF trusting `edoatley/idp-prototype`,
  least-privilege `idp-ci` service account. *Exit:* a hello-world Action can `terraform apply`
  a bucket via WIF with no stored keys.
- **Phase 1 — Terraform golden path**. `idp-gitops/modules/gcs-bucket` (all guardrails +
  input validation) + per-stack `metadata.yaml` (the inventory record) + `pr.yml`/`apply.yml`.
  *Exit:* merging a PR provisions a real compliant bucket; state in GCS.
- **Phase 2 — Policy-as-code gate**. Rego/Conftest against `terraform show -json` in PR CI.
  *Exit:* a non-compliant PR (e.g. public access) is blocked.
- **Phase 3 — Thin portal (write path)**. Form (name, owning_team, environment) → generates a
  stack + `metadata.yaml` → opens the PR. *Exit:* a dev provisions a bucket with no Terraform knowledge.
- **Phase 4 — Day-2**. `drift.yml` (scheduled plan flags console changes) + decommission
  (`destroy.yml` + portal delete). *Exit:* drift is surfaced; self-service delete works.
- **Phase 5 — Visibility & metrics** *(the headline)*. Dashboard aggregating inventory +
  ownership, delivery metrics (lead time / success rate from GitHub PR+Actions data), and
  compliance/drift status. *Exit:* one place to see what exists, who owns it, how the platform
  performs, and whether it's compliant.
- **Phase 6 — Evaluate/migrate to Backstage**. Re-implement the golden path on Backstage
  against the unchanged `idp-gitops` backend; compare (see `EVALUATION.md`).

## Conventions

- **org_prefix**: `edo` · **region**: `europe-west2` (London) · **environments**: `dev|test|prod`.
- **Bucket naming**: `${org_prefix}-${environment}-${team}-${name}` (lowercased, validated).
- **Mandatory labels**: `owning-team`, `environment`, `managed-by=idp`, `request-id`.
- **Enforced (non-overridable) guardrails**: uniform bucket-level access, public-access
  prevention = enforced, versioning on. Enforcement lives in the module; the policy gate is a
  second, independent check.
- **Teams / ownership**: `idp-gitops/platform/teams.yaml` (fictional for the prototype).

## Working agreements

- **GitOps, PR-based**: `plan` on PR, `apply` on merge. Every request is an auditable PR.
- **Meaningful PRs**: one coherent change per PR; keep them reviewable.
- Commit only when asked; branch off `main`. End commit messages with the
  `Co-Authored-By: Claude Opus 4.8` trailer and PR bodies with the Claude Code footer.
- Never commit secrets or Terraform state; `*.tfvars` and `*.tfstate` are gitignored.
  WIF is keyless, so bootstrap outputs are published as **GitHub repository variables**, not secrets.

## Common commands

```bash
# Bootstrap (Phase 0) — run once, local state
cd idp-bootstrap && cp terraform.tfvars.example terraform.tfvars
./bootstrap.sh                 # init + plan + (confirmed) apply
./bootstrap.sh --plan-only     # inspect without applying
./bootstrap.sh --set-github-vars  # publish outputs as GitHub repo variables (needs gh)

# Any Terraform dir
terraform fmt && terraform validate
terraform test                 # unit tests via mock_provider (no cloud, no creds)
```

## Testing strategy

- **`terraform test` + `mock_provider "google"`** for guardrail invariants (UBLA, public-access
  prevention, versioning, WIF scope, IAM least-privilege) — fast, credential-free, CI-friendly.
- **PR CI**: `terraform fmt -check`, `validate`, `tflint`.
- **Policy gate (Phase 2)**: Conftest/OPA against the plan JSON — the independent second layer;
  static scanners like tfsec/checkov, if used, belong there, not duplicated in unit tests.
