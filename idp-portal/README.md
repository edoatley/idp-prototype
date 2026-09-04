# idp-portal (Phase 3)

The **thin custom portal** — both the write path (create/decommission a bucket) and the read
path (the Phase 5 oversight dashboard). A developer picks four things (`name`, `owning_team`,
`environment`, `requester`); the portal generates a Terraform stack indistinguishable from a
hand-written one and opens a PR on the repo. The existing CI does the rest: `pr.yml` plans +
runs the policy gate, and on merge `apply.yml` provisions the bucket via keyless WIF.

Deliberately thin: **no database** (the repo *is* the inventory) and **no GCP credentials**;
provisioning stays in CI. Teams and environments come from
`idp-gitops/platform/{config.yaml,teams.yaml}`.

> **How the generated Terraform actually works** — the templates, the naming conventions, the
> git-data API sequence and the sharp edges — is documented in
> [`docs/portal-to-terraform.md`](../docs/portal-to-terraform.md).

## Layout

```
src/config.ts      # load platform conventions (envs, teams) from platform/*.yaml
src/validate.ts    # mirror the module's input validation, fail early
src/requestId.ts   # unique request id (GCS label-value charset)
src/generator.ts   # PURE: request -> stack files (main.tf + metadata.yaml)
src/github.ts      # open a branch/commit/PR via the GitHub git-data API (plain fetch)
src/server.ts      # the form, POST handlers, /buckets and /dashboard
src/inventory.ts   # READ: walk stacks/*/*/metadata.yaml -> the inventory
src/metrics.ts     # READ: apply success rate + lead time from the GitHub API
src/compliance.ts  # READ: policy pass-rate + open `Drift:` Issues
```

## Develop

```bash
npm ci
npm run typecheck
npm test           # vitest — generator/validate/config unit tests (no network, no creds)
```

## Run

Needs a **fine-grained PAT** with *Contents: read/write* and *Pull requests: read/write* on
`edoatley/idp-prototype`:

```bash
export GITHUB_TOKEN=github_pat_...        # never commit; .env is gitignored
export GITHUB_REPO=edoatley/idp-prototype
export PORT=3000
npm run dev
```

Open `http://localhost:3000`, submit the form, and follow the PR link. Review + merge to
provision the bucket.
