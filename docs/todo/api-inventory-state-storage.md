# Where the API's inventory should actually live

**Summary:** The API reads its inventory from the local working tree, so it can 404 a bucket it has just provisioned; decide whether the fix is persistent state in GCP or reading the GitOps repo directly.

**Branch context:** `docs/cli-walkthrough-capture` — capturing walkthrough page 8 against the real platform, which is where this surfaced.

## Why deferred

Hit live while walking the golden path: `idp bucket create` provisioned a bucket (PR #64, applied), then `idp bucket update` answered `Error: Not found` because the checkout was two commits behind. Parked deliberately — the user wants to finish the walkthrough first, and the choice here is architectural rather than a patch.

## Context

**Relevant files:**
- `idp-core/src/inventory.ts` — `listBuckets()` walks `idp-gitops/stacks/*/*/metadata.yaml` on disk; `defaultStacksDir()` resolves to the local checkout (overridable via `STACKS_DIR`).
- `idp-portal/src/api/router.ts` (`:29`, `:37`) and `idp-portal/src/api/writes.ts` (`:132`) — every read and the write path's existence checks call `listBuckets()`.
- `idp-core/src/drivers/githubPr.ts` — already talks to GitHub with the caller's token; `refuseIfStackExists()` reads the **base branch**, so the write path can already see the true state.
- `EVALUATION.md` — the hardening backlog entry describing this defect.
- `PRD.md` — "no datastore; the repo IS the inventory" is a stated design decision, so changing it is a deliberate reversal.

**Current state:** The repo is the source of truth, but the API reads a *copy* of it — whatever was last pulled. `bucket list` silently shows a stale world, and writes 404 on a resource that exists. Nothing surfaces the staleness. Note the asymmetry already present: `refuseIfStackExists()` consults GitHub directly, so the driver is right about the world while the routes are not.

**Key constraints:**
- Reads are currently unauthenticated (`security: []` in `contracts/openapi.yaml`); reading from GitHub would need a token or a server-held credential, changing the contract's auth story.
- The platform holds no long-lived credentials by design (keyless WIF, caller-supplied tokens). A GCP datastore reintroduces something to provision, authorise and secure.
- A datastore becomes a *second* source of truth that can disagree with the repo — the drift problem the GitOps design exists to avoid. Whatever is chosen must say how the two stay reconciled (or that the store is a cache, explicitly).

## What to do

1. Decide between three options, and record the reasoning in `EVALUATION.md`:
   - **A. Read the base branch via the GitHub API.** Keeps one source of truth; costs an API call per read and a credential for reads.
   - **B. Persistent state in GCP** (user's instinct: a bucket or a table). Fast reads, survives away from a checkout; introduces a second source of truth and something to keep in sync — say explicitly whether it is authoritative or a cache rebuilt from the repo.
   - **C. Cheap honesty first.** On a write miss, ask GitHub whether the stack exists on the base branch and answer *"exists on main; your checkout is stale"*. Small, kills the specific lie, buys time for A or B.
2. If A or B: put it behind the existing `listBuckets()` boundary so `router.ts` and `writes.ts` do not change shape.
3. Whatever is chosen, make staleness impossible to miss — a read should be able to state the commit it reflects.
4. Update the note in `docs/walkthrough/08-api-and-cli.md` that currently tells the reader to `git pull` after merging a create; that instruction exists only because of this defect.

## Acceptance criteria

- [ ] `bucket create` → merge → `bucket update` succeeds with no manual `git pull` between them.
- [ ] A read reports, or can report, the repo state it reflects.
- [ ] `EVALUATION.md` records which option was taken and why, including how a second source of truth is reconciled if one was introduced.
- [ ] `PRD.md`'s "no datastore" decision is either upheld or explicitly revised — not silently contradicted.
- [ ] The `git pull` workaround is removed from walkthrough page 8.

## Related specs / docs

- [`PRD.md`](../../PRD.md) — "Visibility & metrics": on-demand aggregation, no datastore.
- [`EVALUATION.md`](../../EVALUATION.md) — Phase 7 hardening backlog, where this is listed as the most serious open item.
