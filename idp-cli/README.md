# idp-cli

The platform's command line. Everything the portal form can do, from a terminal or a pipeline —
`create`, `list`, `describe`, `update`, `delete`, plus tracking a change to completion.

It is a **pure client of the platform API**: it knows nothing about Terraform, GitOps or GitHub.
Its types are generated from [`contracts/openapi.yaml`](../contracts/openapi.yaml), so a contract
change the client has not followed fails a typecheck rather than someone's pipeline.

## Use

```bash
export IDP_API_URL=http://localhost:3000        # default
export IDP_TOKEN=github_pat_...                 # falls back to $GITHUB_TOKEN

idp bucket list
idp bucket list --team checkout -o json
idp bucket describe edo-dev-checkout-orders

# See exactly what would be committed, without opening anything
idp bucket create --name orders --team checkout --env dev --requester octocat --dry-run

# Open the request for real, then follow it to completion
idp bucket create --name orders --team checkout --env dev --requester octocat --wait

idp bucket update edo-dev-checkout-orders --retention-days 30 --storage-class NEARLINE
idp bucket update edo-dev-checkout-orders --clear-retention
idp bucket delete  edo-dev-checkout-orders

idp request list
idp request status req-20260905-checkout-orders-a1b2 --wait
idp status                                       # delivery metrics + compliance
```

Reads need no credential. Writes send **your** GitHub token, so the change is attributed to you
and your existing repo permissions decide whether it is allowed — the platform stores no secret.

## `--wait` in a pipeline

`--wait` polls until the request is done and **exits non-zero if it did not succeed**, so a CI job
that asks for a bucket actually fails when it does not get one. It also stops on `blocked` (the
policy gate refused): that needs a human, and nothing the waiting process does will move it.
`IDP_POLL_INTERVAL_MS` overrides the 10s poll interval.

## Output

`-o table` (default, for humans), `-o json` and `-o yaml` (for pipelines). Errors come back as
the API's problem documents, printed field by field:

```
Error: Validation failed
  The request violates a platform convention.
  owning_team: owning_team must be a known team: payments, checkout, search, platform.
```

## Develop

From the repo root (one npm workspace):

```bash
npm ci
npm run generate -w idp-cli   # regenerate src/schema.d.ts from the contract
npm run typecheck
npm test
./idp-cli/bin/idp.js --help
```

`src/schema.d.ts` is generated and committed; CI regenerates it and fails on any diff.
