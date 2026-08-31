# idp-portal (Phase 3)

The **thin custom portal** — the write path of the golden path. A developer picks three
things (`name`, `owning_team`, `environment`); the portal generates a Terraform stack that
*exactly mirrors* a hand-written one (`idp-gitops/stacks/dev/platform-demo/`) and opens a PR
on the repo. The existing CI does the rest: `pr.yml` plans + runs the policy gate, and on
merge `apply.yml` provisions the bucket via keyless WIF.

Deliberately thin: **no database**, and **no GCP credentials**. Conventions come from
`idp-gitops/platform/{config.yaml,teams.yaml}`; provisioning stays in CI.

## Layout

```
src/config.ts      # load platform conventions (org prefix, region, envs, teams)
src/validate.ts    # mirror the module's input validation, fail early
src/requestId.ts   # unique request id (GCS label-value charset)
src/generator.ts   # PURE: request -> stack files (main.tf + metadata.yaml)
src/github.ts      # (PR2) open a branch/commit/PR via Octokit
src/server.ts      # (PR2) the form + POST handler
```

## Develop

```bash
npm ci
npm run typecheck
npm test           # vitest — generator/validate/config unit tests (no network, no creds)
```

## Run (PR2)

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
