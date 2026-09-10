# Make the inventory read the repo, not a copy of it

**Status:** implemented · **Decided:** 2026-09-08 · **Shipped:** 2026-09-09

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

- `idp-core/src/inventory.ts` → `inventory/` — `source.ts` (the port + `InventoryUnavailableError`),
  `record.ts` (`toRecord`, shared by both sources so they cannot describe a stack differently),
  `file.ts`, `github.ts`; exported from `idp-core/src/index.ts`.
- `idp-portal/src/inventory.ts` — where environment becomes a configured source, and a
  per-request middleware in `server.ts` puts one on `res.locals`. `idp-core` still reads no GitHub
  config from the environment.
- `idp-portal/src/api/router.ts` (both bucket handlers) — become async, wrapped in the existing
  `asyncRoute` from `api/problem.ts` so rejections reach `problemHandler`, which already
  translates `GitHubError` → 401/403/502.
- `idp-portal/src/api/writes.ts` — the `buckets()` helper becomes async.
- `idp-portal/src/server.ts` — `renderInventory()` and its route become async; `/dashboard` and
  `/buckets/decommission` are already async and just need `await`.
- `contracts/openapi.yaml` — `502` on `listBuckets` and `describeBucket`. They can now fail
  upstream, and the response validator refuses an undocumented status at runtime (proven when a
  403 came back as a 500). Deliberately **not** 401/403: both operations are open, and the
  credential in play is the platform's, so `GitHubInventory` wraps `GitHubError` into
  `InventoryUnavailableError` rather than blaming whoever happened to ask.

## Increments

The first slicing — "extract the port with no behaviour change, then add the GitHub source and
make it the default" — was rejected on review: step 1 moved nothing observable and step 2 carried
both the new read path and the switch. Re-sliced by risk instead, so each step retires some:

1. **The port, and a reachable 502.** `InventorySource` + `FileInventory`, the call sites async,
   and `502` added to `listBuckets`/`describeBucket` — proven by a stub source that rejects, so
   the failure path was live and covered before any GitHub code existed. Verified negatively too:
   deleting the contract entry makes that test fail, which is what "the contract is enforced"
   means in practice.
2. **`GitHubInventory`, opt-in.** Behind `IDP_INVENTORY=github`, unit-tested against a stubbed
   fetch, then A/B'd against the file source on the real repo — identical JSON, byte for byte —
   while nothing depended on it.
3. **The flip.** One default, revertible with one env var; then the sequence that failed, run for
   real; then the workaround and the docs.

## Verification

Credential-free: `npm run lint:api && npm run typecheck && npm test`. The suites pin
`IDP_INVENTORY=file` themselves, so CI needs no credential and no network.

Against the real repo, from a checkout with an **empty `stacks/`** — the shape of "two commits
behind", and the condition under which the original defect fired:

| | `IDP_INVENTORY=file` | `IDP_INVENTORY=github` |
|---|---|---|
| `GET /v1/buckets` | `{"buckets":[]}` | `["edo-dev-platform-refactor-check"]` |
| `GET /v1/buckets/edo-dev-platform-refactor-check` | `404` | `200` |

That second row is the walkthrough failure, reproduced and fixed: the resource exists, and the
platform now says so regardless of the checkout.

The failure modes, also checked live:

- `GITHUB_REPO` pointing at a nonexistent repo → **502**, carrying GitHub's own `Not Found`; never
  a stale or empty list.
- `GITHUB_TOKEN` unset → **502** naming the fix (`IDP_INVENTORY=file`), while `/`, `/healthz` and
  `/v1/catalog/*` keep working — they do not need the inventory.
- `/buckets` and `/dashboard` answer **502** and say "Inventory unavailable: …" in place of the
  table. An empty table under a red banner still reads as "nothing exists", and a monitor watching
  status codes would have seen a healthy 200.

## Known limits, accepted

- **Reads spend the platform's rate limit.** Both read operations stay open (`security: []`), so
  anonymous traffic draws on one 5000/hr budget. Exhausting it 502s every read while writes —
  which carry the caller's token — keep working. Acceptable at this scale; the fix, if it ever
  bites, is to require a token on reads too.
- **The 502 body names server-side environment variables** (`GITHUB_TOKEN`, `IDP_INVENTORY`) when
  the source is misconfigured. That is config disclosure on an open endpoint, traded deliberately
  for an operator being told what to fix rather than having to read logs.
- **One bad `metadata.yaml` on `main` stops every read**, by name and with a 502. The alternative —
  skipping the record — is a partial inventory that looks complete, which is the failure class this
  whole change exists to remove.
- **`main` is hardcoded**, matching `GitHubPrDriver`. There is no way to point the platform at a
  different base branch, and nothing needs one yet.

## Out of scope

`loadConfig()` (`idp-core/src/config.ts`) still reads `platform/config.yaml` from disk and has the
same staleness class — a team added by PR is invisible until pull. Lower frequency, lower harm;
the seam it would use is now in place. Also open: no `--timeout` on `idp ... --wait`, and
`submitted_by` for non-forgeable create attribution.
