# idp-core

The **portal-agnostic domain** of the IDP: everything that turns a developer's request into a
reviewable change, and everything that reads the platform's state back out. No HTTP surface
lives here — the portal UI, the HTTP API and the CLI are all thin surfaces over this package,
so a new surface never re-implements the golden path.

Extracted from `idp-portal/src` so it could be shared; the behaviour is unchanged.

```
src/config.ts      # load platform conventions (envs, teams) from platform/*.yaml
src/validate.ts    # mirror the module's input validation, fail early
src/requestId.ts   # unique request id (GCS label-value charset)
src/generator.ts   # PURE: request -> stack files (main.tf + metadata.yaml)
src/github.ts      # open a branch/commit/PR via the GitHub git-data API (plain fetch)
src/inventory.ts   # READ: walk stacks/*/*/metadata.yaml -> the inventory
src/metrics.ts     # READ: apply success rate + lead time from the GitHub API
src/compliance.ts  # READ: policy pass-rate + open `Drift:` Issues
src/index.ts       # the public surface — consumers import from `idp-core`, never a deep path
```

Two path defaults resolve to the GitOps repo at `../../idp-gitops/...` and are overridable via
`PLATFORM_DIR` / `STACKS_DIR` (the tests use fixtures through those seams).

## Develop

Run from the repo root — the Node packages are one npm workspace:

```bash
npm ci
npm run typecheck
npm test           # vitest — pure unit tests, no network and no credentials
```
