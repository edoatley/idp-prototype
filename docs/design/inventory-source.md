# Make the inventory read the repo, not a copy of it

**Status:** agreed, not yet implemented · **Decided:** 2026-09-08

## The problem

Walking [the CLI walkthrough](../walkthrough/08-api-and-cli.md) produced this:

1. `idp bucket create` → PR #64 → merged → bucket provisioned in GCP ✅
2. `idp bucket update` → **`Error: Not found. No bucket edo-dev-checkout-orders`** ❌

The platform denied a resource it had just created, immediately after its own happy path.

`listBuckets()` (`idp-core/src/inventory.ts`) walks `idp-gitops/stacks/*/*/metadata.yaml` **on
local disk**, and the checkout was two commits behind `main`. Nothing surfaced the staleness —
`idp bucket list` simply showed an older world, confidently. The misdiagnosis is instructive
too: `idp bucket list` and `ls idp-gitops/stacks/` agreed, which looked like corroboration but
was two views of one stale source. `gcloud` was the only independent check.

[`PRD.md`](../../PRD.md) says *"the repo IS the inventory"*. It is not: the API reads a **copy**
of the repo — whatever was last pulled. This work makes that sentence literally true.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Source of truth | Read the base branch live via the GitHub API | A datastore would be a second source of truth that can silently disagree with the repo — the bug class being fixed, relocated. `PRD.md`'s "no datastore" decision is **upheld**. |
| Read credential | The server's token | The portal already holds `GITHUB_TOKEN` for the HTML form, so no new class of secret. Reads stay open to callers; writes keep using the caller's token, so "we act as you" still holds for everything that changes anything. |
| Shape | An `InventorySource` port | Same seam as the existing `ChangeDriver`; no new architectural idea. Keeps offline dev and the test suite working. |

A persistent store was the starting instinct and was rejected deliberately. If the platform ever
has to run somewhere without repo access, that calculus changes — and the port below is exactly
where a store would slot in.

## Verified before committing to this

Both calls were run against the real repo, because the cost argument depends on them:

- `GET /git/trees/main?recursive=1` → **one call**. Accepts a branch name; returned 187 entries
  with `truncated: false`, including every `metadata.yaml` path and blob SHA.
- `GET /git/blobs/{sha}` → `encoding: base64`, decodes to the record. **Needs the full 40-char
  SHA**; a shortened one 404s.

## Design

```ts
// idp-core/src/inventory/
export interface InventorySource {
  list(): Promise<BucketRecord[]>;
}
```

- **`GitHubInventory`** — the default. One tree call, then a blob fetch per `metadata.yaml` whose
  SHA is not already cached.
- **`FileInventory`** — today's logic, unchanged, for offline work and tests.

Selected by `IDP_INVENTORY=file|github`, defaulting to `github`.

Three properties this must preserve, each of which is a way the original bug could return:

1. **No silent fallback.** If GitHub is unreachable the read fails (502). Quietly serving a stale
   disk copy is the original bug in disguise.
2. **Cache blobs by SHA, and nothing else.** Git blob SHAs are content-addressed, so a cached SHA
   can never be the wrong content — the cache cannot go stale, by construction. **No TTL on the
   tree call**: a time-based cache reintroduces exactly this bug with a smaller window. Fetch the
   tree per request (memoised within a request, since `writes.ts` reads the inventory twice in
   one `POST`). Steady state is 1 API call per request, and correctness is unconditional rather
   than probabilistic.
3. **Truncation must raise.** The trees API sets `truncated: true` on very large trees. A
   truncated response yields a *partial inventory that looks complete* — the same failure mode.

## Files to change

- `idp-core/src/inventory.ts` → `inventory/file.ts` (existing parsing reused verbatim) +
  `inventory/github.ts` + the port; export from `idp-core/src/index.ts`.
- `idp-portal/src/api/router.ts` (both bucket handlers) — become async, wrapped in the existing
  `asyncRoute` from `api/problem.ts` so rejections reach `problemHandler`, which already
  translates `GitHubError` → 401/403/502.
- `idp-portal/src/api/writes.ts` — the `buckets()` helper becomes async.
- `idp-portal/src/server.ts` — `renderInventory()` and its route become async; `/dashboard` and
  `/buckets/decommission` are already async and just need `await`.
- `contracts/openapi.yaml` — add `502` to `listBuckets` and `describeBucket`. They can now fail
  upstream, and the response validator refuses an undocumented status at runtime (proven when a
  403 came back as a 500).

## Increments

1. **The port, no behaviour change.** Extract `FileInventory` behind the interface, make the call
   sites async, keep the filesystem as the default. Everything passes; nothing moves yet.
2. **`GitHubInventory`, and make it the default.** Unit-tested against a stubbed fetch in the
   style of `idp-core/tests/drivers.test.ts`: one tree call; a blob fetched only on first sight
   of its SHA; truncation raises; an unreachable GitHub raises rather than falling back.
3. **Remove the workaround.** Delete the `git pull` instruction from walkthrough page 8, and
   record in `EVALUATION.md` that the "no datastore" decision was upheld and why.

## Verification

Credential-free: `npm run lint:api && npm run typecheck && npm test`, with `IDP_INVENTORY=file`
so the existing suites stay offline.

End to end — **the exact sequence that failed**, which is the only real proof:

1. `idp bucket create --name orders --team checkout --env dev`
2. Merge the PR; wait for apply.
3. `idp bucket update <bucket> --retention-days 30` — **without `git pull`**. Must succeed.
4. `idp bucket list` from a checkout deliberately reset a few commits back — must still show the
   true inventory.
5. Point `GITHUB_REPO` at a nonexistent repo — must 502 with GitHub's message, never a stale or
   empty list.

## Out of scope

`loadConfig()` (`idp-core/src/config.ts`) reads `platform/config.yaml` from disk and has the same
staleness class — a team added by PR is invisible until pull. Lower frequency, lower harm.
Also open: no `--timeout` on `idp ... --wait`, and `submitted_by` for non-forgeable create
attribution.
