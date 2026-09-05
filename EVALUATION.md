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
  - **The independent gate works and blocks end to end.** A throwaway PR with a raw public
    bucket that *bypasses the module* planned fine, then the `pr.yml` conftest gate failed
    with 9 denials (public access, UBLA, versioning, region, all four labels, name prefix) →
    `plan` check red → merge blocked → nothing applied. The PR comment listed exactly *why*.
  - **Where the value landed:** defence in depth — the module *prevents* (safe by
    construction), the gate *detects* (audits the plan). The module's `terraform test` can't
    catch a stack that doesn't use the module; the gate can. The plan JSON
    (`resource_changes[].change.after`) is a stable, portal-agnostic contract to police.
  - **Rego/Conftest gotchas worth remembering:** `conftest verify` needs `--policy <dir>`
    (a positional path silently fails); modern Conftest is Rego v1 (`import rego.v1`,
    `deny contains msg if { … }`); `object.union` *deep-merges*, so a test fixture that meant
    to *drop* a label had to `object.remove` the key first. Install via `brew`/pinned tarball
    (the sandbox blocks piping install scripts to a shell).
  - **Cost:** the guardrail list now lives in two places — the module *and* the Rego. That
    duplication is the point (independent layers), but keeping them in sync is real
    maintenance; a future phase could generate one from a shared spec.
- Phase 3 (thin portal, write path):
  - **Self-service works with zero Terraform knowledge.** A form submission (name/team/env)
    generated a stack that byte-mirrors `platform-demo`, opened a real PR, and flowed through
    the *same* plan → policy-gate → WIF-apply path — provisioning `edo-dev-checkout-orders`.
  - **Where the value landed:** the portal is genuinely *thin* — no database, no GCP creds; it
    only generates the artifacts a human would and opens a PR. The portal-agnostic backend paid
    off: adding a whole new component required **zero** backend changes. Keeping the generator
    **pure** (inputs→files) made it trivially unit-testable; the only real risk — generated HCL
    must be `terraform fmt`-clean or `pr.yml` rejects it — was caught by verifying with
    `terraform fmt` (block keys are fixed, so alignment is constant across all requests).
  - **Visibility gap found + closed:** `apply.yml` runs on push to main, so the *provisioning*
    result never showed on the PR (only the pre-merge plan/gate did). Added an apply → PR
    audit-trail comment (finds the PR via `listPullRequestsAssociatedWithCommit`). Authoritative
    trail stays the Actions run + GCP audit logs + `metadata.yaml`; the dashboard (Phase 5)
    aggregates it.
  - **Gotchas:** `@octokit/rest` is ESM-only vs our CommonJS — sidestepped with a tiny
    fetch-based GitHub client (also easier to unit-test via an injected `fetch`). Dependabot
    bumped vitest 2→4 mid-flight → a `package.json`/lock conflict; regenerated the lockfile,
    tests passed on v4. Squash-merges mean feature branches aren't ancestors of `main`, so
    follow-ups must branch off `origin/main`.
- Phase 4 (day-2: drift + decommission):
  - **Day-2 works as GitOps, end to end.** `drift.yml` (scheduled + on-demand) planned every
    stack; disabling versioning out of band opened a `Drift:` Issue with the plan, and reverting
    auto-closed it. `destroy.yml` decommissioned a stack on removal (`checkout-orders` → 404)
    with a `♻️ Decommissioned` comment, while `apply.yml` correctly *skipped* on the same push
    (disjoint sets). The portal now closes the loop: it lists buckets from `metadata.yaml` and a
    Decommission button opens the removal PR. Apply also gained a `✅ Applied` audit comment (#23).
  - **Where the value landed:** oversight became *concrete and actionable* — drift is a
    self-closing Issue, and every provision/decommission leaves an audit comment on the PR where
    it was requested. The full create → apply → list → decommission → destroy loop is
    self-service over GitOps with the *same* guardrails throughout.
  - **Gotchas worth remembering:** `hashicorp/setup-terraform`'s default wrapper **swallows
    `plan -detailed-exitcode`'s exit code 2** — set `terraform_wrapper: false` (the drift demo
    is what surfaced this). Destroying a removed stack needs the config **restored from the
    parent commit** (`git checkout <before> -- <dir>`), since it's gone on HEAD. `workflow_dispatch`
    only lists workflows on the default branch, but you can run a fix branch's version with
    `--ref` — invaluable for validating a workflow fix *before* merging. Deleting files via the
    GitHub git-data API = tree entries with `sha: null`. Kept `force_destroy = false` (empty
    buckets only; non-empty fails loudly).
- Phase 5 (visibility & metrics — the headline):
  - **The oversight payoff, from data the pipeline already produced.** One `/dashboard` page
    aggregates, on demand and with **no datastore / no GCP creds**: inventory + ownership (from
    each `metadata.yaml`), delivery (apply success **100% (5/5)**, lead time, recent requests via
    the GitHub API), and compliance/drift (**policy pass-rate 83% (5/6)**, open drift none).
  - **Did it feel valuable? Yes — and it's self-evidencing.** The 83% policy pass-rate *is* the
    guardrail working: the missing run is the deliberately-public PR the gate blocked. Drift
    Issues feed compliance; `metadata.yaml` is the inventory; PR/Actions timestamps give
    delivery. Everything the dashboard reads is **portal-agnostic**, so Backstage (Phase 6)
    could surface the same signals — proving the backend, not the portal, is the durable value.
  - **What was missing (honest, = the hardening backlog):** lead time is PR opened→merged, not
    true PR→apply-complete (loose correlation); policy pass-rate is a *proxy* from `pr.yml` run
    outcomes, not a dedicated policy signal; inventory is desired-state only (no GCP cross-check,
    so orphaned/manually-created buckets aren't shown); no trends/time-series; metrics are
    recomputed per request (fine at this scale). None block the "can I see what exists, who owns
    it, how we're doing, and are we compliant?" question — which is answered.

- **Phase 7 — API + CLI (the programmatic surfaces).** Added `contracts/openapi.yaml`, a JSON
  API mounted on the portal's own Express app, and `idp-cli`. The three surfaces (form, API,
  CLI) now share one change layer in `idp-core`.
  - **The cheap part was the API; the valuable part was the extraction.** Standing up the JSON
    routes took far less effort than expected because the portal's domain logic was already
    free of HTTP. What actually paid off was making the *change submission* a port
    (`ChangeDriver`): before, the portal derived branch names, PR titles and bodies inline in
    each form handler, so a second surface would have duplicated those conventions and slowly
    diverged. Refactoring the portal's own handlers onto the shared layer — rather than leaving
    them alongside it — is what makes "one golden path" true rather than aspirational.
  - **Contract-first was worth it, but only because the contract is enforced.** A spec that is
    merely published rots. Two things keep this one honest: `express-openapi-validator`
    validates **responses** as well as requests (a handler that stops matching the contract
    fails the suite — proven by a test that deliberately breaks it), and the CLI's client types
    are *generated* from the same file, with CI failing on any diff. Spec, server and client
    cannot drift independently.
  - **"Update" forced a real design question.** The module had no mutable input: `name`,
    `owning_team` and `environment` all feed the derived bucket name, so changing any of them is
    a destroy-and-recreate, not an update. Rather than fake it, the module gained a deliberately
    small set of safe knobs (`retention_days`, `storage_class`, `extra_labels`) and PATCH
    **rejects** an immutable field with a 400 instead of silently ignoring it. The retention knob
    only ever expires *noncurrent* versions, enforced in the module and re-checked by an
    independent Rego rule — deleting live data is the one bucket change that cannot be undone.
  - **Tests earned their keep twice.** A `terraform test` caught a validation bug that would have
    waved every out-of-range retention through (`can(0 >= 1)` is `true` — `can()` reports whether
    an expression *evaluated*, not what it evaluated to). And running real `terraform fmt`
    against generated stacks caught that fmt gives an argument opening a multi-line block a
    single space and ends the alignment run — hand-aligned templates would have failed
    `pr.yml`'s `fmt -check` on every request carrying labels.
  - **Statelessness held under pressure.** The obvious way to answer "where is my request?" is a
    requests table. Instead status is derived live from PR state, check runs and the sticky audit
    comments the workflows *already* post (`<!-- tf-apply:… -->`). No new CI plumbing, no
    datastore, and status cannot disagree with reality. The cost is several GitHub API calls per
    poll — fine at this scale, and the honest trade to record.
  - **What is missing (the hardening backlog):** request lookup scans recent PRs rather than
    using the search API, so a very old request eventually falls off; there is no idempotency
    key, so a retried create relies on the stack-collision guard; the single-writer check is
    read-then-write and could race under genuine concurrency; and the API reads inventory from a
    local checkout, so deploying it away from the repo needs a GitHub-backed inventory source.

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
