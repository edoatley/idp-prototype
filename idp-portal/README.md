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

The portal is now only the **HTML surface**; everything portal-agnostic lives in
[`idp-core`](../idp-core/README.md) so the API and CLI share one implementation of the golden
path.

```
src/server.ts      # the form, POST handlers, /buckets and /dashboard
```

## Develop

Run from the **repo root** — the Node packages are one npm workspace:

```bash
npm ci             # installs idp-core + idp-portal together (one lockfile)
npm run typecheck
npm test           # vitest, in idp-core (no network, no creds)
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
