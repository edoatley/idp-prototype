# PRD: Internal Developer Platform (IDP) — Prototype

## Context

The objective is to **experience, first-hand, the value and component parts of an Internal
Developer Platform** — and in particular *how an IDP delivers oversight, visibility and
metrics* over what developers self-serve. The way we answer that is to build a real,
working slice: developer self-service for creating a GCS bucket in GCP, end to end.

The bucket is deliberately a small capability. The point is **not** "a form that makes a
bucket" (that's `gcloud` in 10 seconds). The point is to feel where an IDP creates value:
the golden path, enforced guardrails, ownership/catalog, an auditable GitOps flow, day-2
lifecycle, and — newly central — the **visibility layer** that shows what exists, who owns
it, how fast/reliably the platform delivers, and whether things stay compliant.

**Phased tooling strategy.** We start with a **thin, disposable custom portal** on top of
**Terraform + a GitOps flow**, and defer **Backstage** to a later phase (evaluate and
migrate once the lightweight prototype proves the value). Critically, the Terraform + GitOps
backend is designed to be **portal-agnostic** — the durable investment — so moving to
Backstage later is a front-end swap, not a rebuild. The architecture must also generalize to
new capabilities (Pub/Sub, CloudSQL, service scaffold) by repeating the pattern.

### Locked decisions
| Decision | Choice |
|---|---|
| Primary success | **Experience IDP value & component parts** — especially oversight/visibility/metrics — via a working slice |
| Phase-1 stack | **Thin custom portal + Terraform + GitOps** (portal-agnostic backend) |
| Backstage | **Deferred** — later phase evaluates migrating the thin portal to Backstage |
| Resource fidelity | **Real GCS bucket** in a real (newly created) GCP project |
| GCP environment | **None yet** — plan includes standing up project, billing, WIF, state backend |
| Request flow | **GitOps, PR-based** (plan on PR, apply on merge) |
| Golden path scope | **Minimal & opinionated** — few inputs, platform enforces the rest |
| VCS / CI | **GitHub + GitHub Actions** |
| Visibility (v1) | **Resource inventory + ownership**, **delivery metrics**, **compliance/guardrail status** (cost visibility deferred) |
| v1 components | Golden-path template, policy-as-code gate, drift detection, decommission, **metrics/visibility dashboard** |
| Evaluation deliverable | Learnings log + a later Backstage-vs-thin-portal comparison |

### Decisions made by default (objectable)
- **Keyless CI→GCP auth via Workload Identity Federation** (no long-lived SA keys).
- **Terraform remote state in a GCS backend**, one state prefix per request (isolated blast radius).
- **The opinionated Terraform module is the primary guardrail** (safe defaults not overridable).
- **Thin portal tech**: a small full-stack app (suggested **TypeScript/Node + minimal React**,
  to keep skills/assets transferable toward an eventual Backstage move) — but any thin stack is fine.
- **GitOps repo is the source of truth** for desired state and resource metadata; the portal *reads* it (and GitHub/GCP APIs) rather than owning its own database.

---

## Goals / Non-goals

**Goals**
- A developer, via the thin portal, requests a bucket with 3 inputs and gets a real, compliant bucket.
- Every request is an auditable Git PR; merge provisions; the module enforces guardrails.
- **Visibility layer** surfaces: what exists + who owns it; delivery metrics (throughput,
  lead time, success rate); compliance/guardrail + drift status.
- Layered guardrails: opinionated module **plus** an independent policy-as-code gate.
- Day-2 covered: drift detection and self-service decommission.
- Backend is portal-agnostic, so Backstage can replace the thin portal later without a rebuild.

**Non-goals (v1)**
- Backstage (deferred to a later phase), multi-cloud, multiple resource types (design for it, ship buckets).
- Cost/FinOps dashboards (labels are applied so it's *possible* later; billing export/BigQuery is out of scope now).
- Production-grade multi-tenant RBAC, SSO hardening, HA hosting.
- Replacing the employer's real platform.

---

## Personas
- **Application developer** — wants a bucket now, shouldn't need to know Terraform/IAM.
- **Platform engineer (you)** — owns the module, portal, policies, pipelines, dashboard.
- **Lead / governance** — wants oversight: what exists, who owns it, is it compliant, how's the platform performing.

---

## Architecture

```
Developer ──fills form (name, team, environment)──► Thin custom portal
                                                        │
                            ┌───────────────────────────┴───────────────────────────┐
                            │ WRITE path                        READ / visibility path│
                            ▼                                                          ▼
                 opens PR on idp-gitops                          aggregates & displays:
                            │                                     • inventory + ownership (from GitOps repo + GCP)
                    GitHub Actions (PR)                           • delivery metrics (from GitHub PR/Actions data)
                    ├─ fmt / validate                             • compliance + drift status (from policy gate + drift job)
                    ├─ plan → show -json
                    ├─ policy gate (conftest/OPA)
                    └─ comment plan on PR
                            │ (merge)
                    GitHub Actions (apply, WIF → GCP)
                            ▼
                 GCP project ── real GCS bucket (compliant)
```

Repos:
1. **`idp-portal`** — thin custom web app: create-a-bucket form (write path) + visibility dashboard (read path). Disposable; replaced by Backstage later.
2. **`idp-gitops`** — Terraform modules, per-request stacks, per-stack metadata, policies, GH Actions workflows. **Portal-agnostic source of truth.**
3. **`idp-bootstrap`** — one-time Terraform: GCP project, billing link, state bucket, WIF pool/provider, CI service account. Applied manually.

---

## The bucket golden path

**Developer inputs (only these):**
- `name` — logical name (platform derives the globally-unique bucket id).
- `owning_team` — the owning team (validated against a known team list).
- `environment` — enum: `dev` | `test` | `prod`.

**Platform-enforced (not user-editable), via the Terraform module:**
- Location/region fixed per policy (e.g. `europe-west2`).
- `uniform_bucket_level_access = true`.
- `public_access_prevention = "enforced"`.
- Versioning enabled.
- Mandatory labels: `owning-team`, `environment`, `managed-by=idp`, `request-id`.
- Deterministic naming: `${org_prefix}-${environment}-${team}-${name}` (lower-cased, length/charset validated).
- Sensible default lifecycle (e.g. abort incomplete multipart uploads); richer lifecycle deferred.

**Isolation:** each request = its own stack dir + its own state prefix, so one bad apply can't harm other buckets.

---

## Request → provision flow (detail)
1. Dev fills the portal form (3 fields).
2. Portal renders a stack dir `stacks/<env>/<team>-<name>/` containing `main.tf` (invokes the
   shared module with validated inputs), a `backend` config (unique state prefix), and a
   `metadata.yaml` (owning team, env, type, request-id, requester, created-at — the inventory record).
3. Portal opens a **PR** on `idp-gitops` and shows the PR link + status back to the developer.
4. **PR CI**: `fmt` → `validate` → `plan` → `terraform show -json` → **policy gate** → plan
   posted as a PR comment.
5. Reviewer (or you) merges.
6. **Merge CI**: `apply` via WIF; the resource is now live and its `metadata.yaml` is the
   canonical inventory record the dashboard reads.

---

## v1 component specs

- **Golden-path template** — the portal-side generator + the opinionated module (above).
- **Policy-as-code gate** — Conftest/OPA (Rego) against `plan -json` in PR CI, independent of
  the module. Policies: deny public access, require mandatory labels, allow only sanctioned
  regions, enforce UBLA. Pass/fail is recorded so the dashboard can show compliance history.
- **Drift detection** — scheduled GitHub Actions workflow runs `terraform plan` across all
  stacks; a non-empty plan (someone changed a bucket in the console) flags drift (opens/updates
  an issue **and** feeds the compliance view).
- **Decommission flow** — a portal action / PR that removes a stack dir; merge CI detects
  removed stacks and runs `terraform destroy`, then removes the inventory record. (Handling
  deletes in GitOps is the fiddly bit — see Risks.)
- **Visibility / metrics dashboard** *(newly central — see below)*.

### Visibility & metrics (the oversight layer)

The read side of the portal. Kept lightweight: **aggregate on demand from existing sources**
(GitOps repo, GitHub API, GCP), not a new datastore or Prometheus stack.

- **Resource inventory + ownership** — list every provisioned resource with team, environment,
  type, request-id, created-at. Source: `metadata.yaml` per stack in `idp-gitops` (desired
  state), optionally cross-checked against live GCP buckets (actual state). Answers *what
  exists and who owns it*.
- **Self-service / delivery metrics** — requests over time, **lead time** (PR opened → apply
  succeeded), and **apply success/failure rate**. Source: GitHub PR timestamps + Actions run
  conclusions/durations via the GitHub API. DORA-flavoured signals showing platform throughput
  and reliability.
- **Compliance / guardrail status** — current compliant/non-compliant count, policy-gate
  pass/fail history, and drift status per resource. Source: policy-gate results + drift-job
  output. Answers *are we staying within the rails*.

---

## Security & guardrails
- **Keyless auth**: GitHub Actions OIDC → GCP Workload Identity Federation → a least-privilege
  CI service account (bucket admin scoped to the project). No SA keys stored anywhere.
- **Portal → GitHub**: a GitHub App (or scoped token) that can open PRs on `idp-gitops` and
  read PR/Actions data for metrics.
- **Defense in depth**: opinionated module (safe defaults) + PR policy gate + optional GCP org
  policy (later, if org access) all prevent public buckets independently.
- Secrets in GitHub Actions secrets / portal env only.

---

## Repo / file layout (to create)

```
idp-bootstrap/                 # one-time, applied manually
  main.tf                      # project, billing, apis, state bucket, WIF pool+provider, CI SA + IAM
  README.md

idp-gitops/                    # PORTAL-AGNOSTIC source of truth
  modules/gcs-bucket/          # THE opinionated, guardrailed module (primary enforcement)
    main.tf  variables.tf  outputs.tf
  stacks/<env>/<team>-<name>/  # generated per request
    main.tf  metadata.yaml     # metadata.yaml = the inventory record
  policy/                      # Rego policies for the conftest gate
  .github/workflows/
    pr.yml                     # fmt/validate/plan/show-json/policy-gate/comment
    apply.yml                  # apply on merge (WIF)
    drift.yml                  # scheduled plan-all → drift flag + issue
    destroy.yml                # handle removed stacks (decommission)

idp-portal/                    # thin, disposable custom app (replaced by Backstage later)
  write/                       # create-bucket form → generates stack + opens PR
  read/                        # visibility dashboard: inventory, delivery metrics, compliance/drift
```

---

## Phased implementation plan

**Phase 0 — GCP + CI foundations (`idp-bootstrap`)**
GCP project + billing, enable APIs, GCS state bucket, WIF (pool/provider trusting the repo),
least-privilege CI service account.
*Exit:* a hello-world GH Action can `terraform apply` a bucket via WIF (no keys).

**Phase 1 — Terraform golden path + GitOps (`idp-gitops`)**
Author `modules/gcs-bucket` with enforced defaults + input validation; define the per-stack
`metadata.yaml`; wire `pr.yml` + `apply.yml`. Prove a hand-written PR provisions a compliant bucket.
*Exit:* merging a hand-written PR provisions a real compliant bucket; state in GCS. **Backend is portal-agnostic.**

**Phase 2 — Policy gate**
Rego policies + conftest step in `pr.yml` against `plan -json`; record pass/fail for later display.
*Exit:* a deliberately non-compliant PR (e.g. public access) is blocked in CI.

**Phase 3 — Thin custom portal, write path (`idp-portal/write`)**
Small app: 3-field form → generates the stack dir + `metadata.yaml` → opens the PR via GitHub
App → shows PR status back to the developer.
*Exit:* a developer creates a bucket end-to-end from the portal, no Terraform knowledge.

**Phase 4 — Day-2 (`idp-gitops`)**
Add `drift.yml` (drift flag + issue) and the decommission flow (`destroy.yml` + portal delete action).
*Exit:* console change is flagged; self-service delete tears the bucket down and clears its record.

**Phase 5 — Visibility & metrics (`idp-portal/read`)** — *the headline experience*
Dashboard aggregating: inventory + ownership (from `metadata.yaml` ± live GCP), delivery
metrics (GitHub PR/Actions API), compliance + drift status (policy-gate + drift output).
*Exit:* you can see, in one place, what exists, who owns it, how fast/reliably the platform
delivers, and whether everything is compliant.

**Phase 6 — Evaluate & (optionally) migrate to Backstage**
With the lightweight prototype proving value, stand up Backstage and re-implement the golden
path + catalog on it, reusing the unchanged `idp-gitops` backend. Compare against the thin
portal (see `EVALUATION.md`) and decide.
*Exit:* an evidence-based recommendation on Backstage vs a lightweight portal for *our* org.

---

## Extensibility (proving the pattern generalizes)
A new capability = repeat three things: a new `modules/<type>` opinionated module, a new portal
form, and reuse of the same resource-agnostic PR/apply/policy/drift/destroy workflows **and** the
same inventory/metrics/compliance dashboard (which key off `metadata.yaml` + GitHub/GCP data). If
a second capability (e.g. a Pub/Sub topic) drops in cleanly, that's direct evidence of IDP value.

---

## Risks / watch-items
- **GitOps deletes are awkward** — detecting removed stack dirs and running `destroy` safely
  is the trickiest workflow; budget time for it.
- **Don't gold-plate the thin portal** — it's deliberately disposable ahead of Backstage; invest
  in the backend and metrics, not portal polish.
- **Metrics scope creep** — resist a full observability stack; on-demand aggregation from
  GitHub/GCP is enough to *experience* the value. Cost visibility is explicitly deferred.
- **State isolation vs sprawl** — per-request state is clean but creates many state prefixes; fine for a prototype.
- **Naming uniqueness** — GCS bucket names are globally unique; validate/derive carefully.
- **WIF misconfiguration** — the common failure mode; verify the trust condition scopes to the repo/branch.

---

## Verification (end-to-end)
1. `idp-bootstrap`: `terraform apply`; confirm project, state bucket, WIF pool, CI SA exist.
2. Trigger the hello-world Action; confirm it provisions & destroys a test bucket via WIF (no keys).
3. From the portal, request a bucket (`name=demo, team=payments, environment=dev`); confirm a PR
   appears on `idp-gitops` with a plan comment, and the portal shows its status.
4. Push a non-compliant variant (public access / bad region); confirm the **policy gate blocks** it.
5. Merge the good PR; confirm apply runs and the **real bucket exists** with enforced UBLA,
   public-access-prevention, versioning, and mandatory labels (`gcloud storage buckets describe`).
6. Open the dashboard; confirm the bucket appears in **inventory owned by `payments`**, a
   **delivery metric** (lead time / success) is recorded, and it shows **compliant**.
7. Manually change the bucket in the console; confirm **drift** is flagged in the dashboard.
8. Run the **decommission** flow; confirm the bucket is destroyed and its inventory record removed.
9. (Phase 6) Re-implement the golden path on Backstage against the same backend; capture the comparison.

---

## Open questions to revisit
- Region / `org_prefix` / team list values (need your actual conventions).
- Thin-portal language/framework (default suggestion: TS/Node + minimal React) — confirm or override.
- Whether to add GCP **org policy** later (only if you gain org/folder access) for a 3rd guardrail layer.
- Which **second capability** to add to test extensibility.
