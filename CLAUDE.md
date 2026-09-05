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
- **Thin custom portal first**; Backstage evaluation *deferred/optional* (see Phases).
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
contracts/         # openapi.yaml — the API contract, shared by server and CLI (spec-first)
idp-core/          # portal-agnostic domain: validate, generate, submit a change, read state
idp-portal/        # HTML surface (form + dashboard) AND the /v1 JSON API, one Express app
idp-cli/           # `idp` command line — a pure client of the API, typed from the contract
.github/
  workflows/       # pr / apply / drift / destroy + the credential-free check pipelines
  scripts/         # the shell + github-script code those workflows delegate to
  actions/         # small composite actions (setup-conftest)
docs/walkthrough/  # Phase 6: guided, screenshot-rich tour of the whole build
docs/portal-to-terraform.md  # reference: how a portal request becomes Terraform
```

## Phases

- **Phase 0 — GCP + CI foundations** ✅ **done**. `idp-bootstrap`: standalone project
  `idp-prototype-edo`, APIs, hardened GCS state bucket, WIF trusting `edoatley/idp-prototype`,
  least-privilege `idp-ci` service account — all applied (see **Current platform state** below).
  The standalone WIF "hello-world" smoke test was intentionally skipped: Phase 1's `apply.yml`
  exercises WIF against a real bucket, which validates the same thing end to end.
- **Phase 1 — Terraform golden path** ✅ **done**. `idp-gitops/modules/gcs-bucket` (all
  guardrails + input validation), the per-stack pattern (proven by `stacks/dev/platform-demo`
  + its `metadata.yaml`), and `pr.yml`/`apply.yml`. A merged PR provisioned the real bucket
  `edo-dev-platform-demo` via WIF, state under its own prefix.
- **Phase 2 — Policy-as-code gate** ✅ **done**. Rego/Conftest (`idp-gitops/policy/`) against
  `terraform show -json`, enforced in `pr.yml` and unit-tested (`conftest verify`) in CI. A
  non-compliant PR (public access) is blocked — proven with a throwaway public-bucket PR.
- **Phase 3 — Thin portal (write path)** ✅ **done**. `idp-portal/` (Node/TypeScript): a
  create-bucket form → generates a stack mirroring `platform-demo` → opens the PR via the GitHub
  API. Proven: a form submission provisioned `edo-dev-checkout-orders` with no Terraform written.
- **Phase 4 — Day-2** ✅ **done**. `drift.yml` (scheduled plan → auto-opening/closing a `Drift:`
  Issue), `destroy.yml` (destroy on stack removal, disjoint from apply), and a portal
  decommission action; apply/destroy post audit comments on the PR. Proven end to end.
- **Phase 5 — Visibility & metrics** *(the headline)* ✅ **done**. `idp-portal` `/dashboard`
  aggregates inventory + ownership (`metadata.yaml`), delivery metrics (apply success rate + lead
  time from the GitHub API) and compliance/drift (policy pass-rate + open `Drift:` Issues) — on
  demand, no datastore, no GCP creds.
- **Phase 6 — Guided walkthrough & showcase** ◀ **NEXT — start here**. A step-by-step
  walkthrough of the whole build (commands + links + screenshots) to understand/showcase it end
  to end. Scaffold lives in [`docs/walkthrough/`](./docs/walkthrough/README.md); the capture pass
  = run each step and drop screenshots into `images/`. (Cold-start runbook below.)
- **Phase 7 — API + CLI** ✅ **done**. `contracts/openapi.yaml` (contract-first, enforced at
  runtime by `express-openapi-validator` in both directions), `/v1` JSON routes mounted on the
  portal app, and `idp-cli`. All three surfaces submit through one change layer
  (`idp-core/src/change.ts` + `drivers/`), so nothing outside `idp-core` knows a change is a PR.
  The `gcs-bucket` module gained its first mutable inputs (`retention_days`, `storage_class`,
  `extra_labels`) so `PATCH` produces a real in-place plan. `idp-gitops` workflows and the policy
  gate were untouched — the extensibility claim, tested.
- **Backstage** — *deferred / optional* (was the old Phase 6). Re-implement the golden path on
  Backstage against the unchanged `idp-gitops` backend and score it vs the thin portal
  (`EVALUATION.md` Part 2). Not currently scheduled.

## Current platform state (Phases 0–5 complete)

Everything a cold start needs for the Phase 6 walkthrough without re-deriving context. These are
real, already-provisioned values (non-secret — WIF is keyless):

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

**Built so far (Phases 1–5)** — the durable artifacts the walkthrough tours:

- `idp-gitops/modules/gcs-bucket/` — guardrailed module + `terraform test`/`mock_provider` suite.
- `idp-gitops/stacks/<env>/<team>-<name>/` — per-request stacks; each `metadata.yaml` is the
  inventory record. **This is the read source for the Phase 5 dashboard.** No stacks are
  provisioned right now — `platform-demo` was decommissioned in #41 and `payments-discounts`
  in #42 — so `stacks/` is empty and the dashboard's inventory panel reads as such. Provision
  one via the portal to exercise the pipelines (an empty `stacks/` makes every matrix job in
  `pr`/`apply`/`destroy`/`drift` skip).
- `idp-gitops/policy/` — Rego/Conftest gate + unit tests (`conftest verify`).
- `idp-core/` — the domain every surface shares: `config.ts`, `validate.ts`, `requestId.ts`,
  `generator.ts` (pure; computes HCL alignment so generated stacks are `fmt`-clean),
  `inventory.ts`, `metrics.ts`, `compliance.ts`, `guardrails.ts`, plus the change layer
  (`change.ts` port + `drivers/githubPr.ts` and `drivers/dryRun.ts`). Reads `platform/*`;
  no GCP creds.
- `idp-portal/` — the HTML surface (`src/server.ts`: form, `/buckets`, `/dashboard`) **and** the
  JSON API (`src/api/`), served from one Express app. Opens PRs with a GitHub PAT
  (`GITHUB_TOKEN`) for the form; the API uses the *caller's* bearer token instead.
- `contracts/openapi.yaml` — the API contract. Linted by redocly (`recommended-strict`;
  `redocly.yaml` records the accepted exceptions) and enforced at runtime on requests **and**
  responses, so a handler that breaks it fails the suite rather than shipping.
- `idp-cli/` — the `idp` command line. `src/schema.d.ts` is **generated** from the contract and
  committed; CI regenerates and fails on any diff.
- `.github/workflows/` — `pr.yml` (plan + policy gate + comment), `apply.yml` (WIF apply +
  audit comment), `drift.yml` (scheduled drift → Issue), `destroy.yml` (decommission +
  audit comment), `terraform-checks.yml` + `node-checks.yml` + `workflow-checks.yml`
  (credential-free CI).
- `.github/scripts/` — the code the workflows delegate to, so the YAML stays readable:
  `detect-stacks.sh` (which stacks a run acts on), `gh-comment.js` + `report-*.js` (the
  sticky PR comments and drift Issues), and `check-local-actions.py` (a lint guard:
  actionlint does not verify that `uses: ./...` resolves). The `report-*.js` modules are
  CommonJS and **dependency-free** — nothing `npm install`s them on the runner.
- `scripts/checks.sh` — local mirror of the credential-free Terraform CI (needs `terraform`,
  `tflint`, `trivy`, `conftest`). `.trivyignore` records accepted scanner exceptions (see
  `EVALUATION.md`).
- `scripts/lint-workflows.sh` — local mirror of `workflow-checks` (needs `actionlint`,
  `shellcheck`, `node`).

## Phase 6 — the capture pass (cold start)

Goal: produce a screenshot-rich, step-by-step walkthrough of the working platform. The narrative,
commands and links are **already written** in [`docs/walkthrough/`](./docs/walkthrough/README.md)
— this phase is the *capture pass*: run each step, take the screenshot, save it to
`docs/walkthrough/images/` with the filename in the placeholder, and commit.

1. Start at [`docs/walkthrough/README.md`](./docs/walkthrough/README.md) — prerequisites +
   TOC (7 pages: foundations → module → portal → PR/gate → apply/audit → dashboard → day-2).
2. Work each page top to bottom: **Do this** (run the command / open the link) → screenshot →
   drop into `images/<NN-name>.png` (the `![caption](…)` already references it).
3. No buckets are live right now (see **Current platform state**); steps needing a fresh
   artifact offer a "re-run to capture" path or a reference permalink to the original PR/run.
4. For the portal + dashboard steps, run locally with the `GITHUB_TOKEN` from `.env` and
   `GITHUB_REPO=edoatley/idp-prototype` (see the walkthrough pages).

*Exit:* the walkthrough reads end to end with real screenshots — the platform is understandable
and showcase-ready from the repo alone.

> **Note:** the `/dashboard` step needs PR #36 merged; the Phase 4/5 learnings docs are PRs
> #32/#36 — merge those so the walkthrough's dashboard step works against `main`.

## Conventions

- **org_prefix**: `edo` · **region**: `europe-west2` (London) · **environments**: `dev|test|prod`.
- **Bucket naming**: `${org_prefix}-${environment}-${team}-${name}` (lowercased, validated).
- **Mandatory labels**: `owning-team`, `environment`, `managed-by=idp`, `request-id`. These four
  are reserved — `extra_labels` may not set or shadow them.
- **Mutable settings** (the only post-provision knobs): `retention_days` (expires *noncurrent*
  versions only), `storage_class` (`STANDARD`|`NEARLINE`), `extra_labels`. Identity
  (`name`/`owning_team`/`environment`) is immutable: it derives the bucket name, so changing it
  would destroy and recreate the bucket.
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

# The Node workspaces (idp-core + idp-portal + idp-cli) — mirrors node-checks CI
npm ci                         # ONE install at the repo root; one lockfile
npm run lint:api               # redocly lint of contracts/openapi.yaml
npm run generate -w idp-cli    # regenerate the CLI's types from the contract
npm run typecheck && npm test

# Run the platform (HTML UI + /v1 API on one port) and drive it from the CLI
GITHUB_REPO=edoatley/idp-prototype npm run dev -w idp-portal
IDP_TOKEN="$GITHUB_TOKEN" ./idp-cli/bin/idp.js bucket list

# All credential-free checks at once — mirrors terraform-checks CI
./scripts/checks.sh            # needs terraform, tflint, trivy, conftest

# Lint the CI machinery itself — mirrors workflow-checks CI
./scripts/lint-workflows.sh    # needs actionlint, shellcheck, node on PATH

# Policy gate (Phase 2)
conftest verify --policy idp-gitops/policy                                   # policy unit tests
conftest test <plan.json> --policy idp-gitops/policy                         # evaluate a plan
```

## Testing strategy

- **`terraform test` + `mock_provider "google"`** for guardrail invariants (UBLA, public-access
  prevention, versioning, WIF scope, IAM least-privilege) — fast, credential-free, CI-friendly.
- **PR CI (credential-free, `terraform-checks.yml`)**: `terraform fmt -check`, `validate`,
  `terraform test`, `tflint`, `trivy config`, and `conftest verify` (policy unit tests). Mirror
  it locally with `scripts/checks.sh`.
- **Policy gate**: Conftest/OPA against the plan JSON — the independent second layer, enforced
  live in `pr.yml`. Static scanners (`trivy`; tfsec/checkov if added) belong in this layer, not
  duplicated in the module's unit tests.
