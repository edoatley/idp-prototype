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

- **Phase 0 — GCP + CI foundations** ✅ **done**. `idp-bootstrap`: standalone project
  `idp-prototype-edo`, APIs, hardened GCS state bucket, WIF trusting `edoatley/idp-prototype`,
  least-privilege `idp-ci` service account — all applied (see **Current platform state** below).
  The standalone WIF "hello-world" smoke test was intentionally skipped: Phase 1's `apply.yml`
  exercises WIF against a real bucket, which validates the same thing end to end.
- **Phase 1 — Terraform golden path** ◀ **NEXT — start here**. `idp-gitops/modules/gcs-bucket`
  (all guardrails + input validation) + per-stack `metadata.yaml` (the inventory record) +
  `pr.yml`/`apply.yml`. *Exit:* merging a PR provisions a real compliant bucket; state in GCS.
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

## Current platform state (Phase 0 complete)

Everything a cold start needs to build Phase 1 without re-deriving context. These are real,
already-provisioned values (non-secret — WIF is keyless):

| Thing | Value |
|---|---|
| GCP project | `idp-prototype-edo` (region `europe-west2`, billing linked, no org) |
| Terraform state bucket | `idp-prototype-edo-tfstate` — **backend for `idp-gitops`, one prefix per request** |
| CI service account | `idp-ci@idp-prototype-edo.iam.gserviceaccount.com` (`roles/storage.admin`) |
| WIF provider (full resource name) | `projects/734077548565/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| WIF trust | scoped to repo `edoatley/idp-prototype` (any branch) |
| Bootstrap state | **local** `idp-bootstrap/terraform.tfstate` (gitignored; keep it to manage foundations) |

**GitHub Actions repository variables** (already set on `edoatley/idp-prototype`) — reference
these in workflows, do not hardcode:
`GCP_PROJECT_ID`, `GCP_REGION`, `TFSTATE_BUCKET`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`.

## Phase 1 — start here (cold start)

Goal: a hand-written PR provisions a real, compliant bucket via GitOps. Build, in order:

1. **`idp-gitops/modules/gcs-bucket/`** — the opinionated, guardrailed module. Inputs: `name`,
   `owning_team` (validate against `platform/teams.yaml`), `environment` (`dev|test|prod`).
   Enforce (non-overridable): region `europe-west2`, uniform bucket-level access,
   `public_access_prevention = "enforced"`, versioning on, mandatory labels
   (`owning-team`, `environment`, `managed-by=idp`, `request-id`), deterministic name
   `edo-${environment}-${team}-${name}` (lowercased, length/charset validated).
2. **Per-request stack pattern** `idp-gitops/stacks/<env>/<team>-<name>/`: `main.tf` (calls the
   module) with a **GCS backend** — bucket `idp-prototype-edo-tfstate`, `prefix =
   stacks/<env>/<team>-<name>` — plus `metadata.yaml` (owning team, env, type, request-id,
   requester, created-at = the inventory record). Prove it with one hand-written stack.
3. **Workflows** `idp-gitops/.github/workflows/`:
   - `pr.yml` — `fmt`/`validate`/`plan` → `terraform show -json` → comment plan on the PR.
   - `apply.yml` — on merge, `apply` for changed stacks. Auth with
     `google-github-actions/auth@v2` using `workload_identity_provider = vars.GCP_WORKLOAD_IDENTITY_PROVIDER`
     and `service_account = vars.GCP_SERVICE_ACCOUNT`; job needs `permissions: id-token: write`.
4. **Tests**: add a `terraform test` + `mock_provider` suite for the module's guardrails (mirror
   `idp-bootstrap/tests/`) and add `idp-gitops/modules/gcs-bucket` to the `terraform-checks`
   workflow matrix in `.github/workflows/terraform-checks.yml`.

*Exit:* merging a hand-written bucket PR applies via WIF and the bucket exists with all
guardrails; state lands under its prefix in `idp-prototype-edo-tfstate`. Full detail in
[PRD.md](./PRD.md).

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
