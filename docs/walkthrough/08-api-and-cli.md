# 8 · The API and CLI — the same golden path, without a browser

**Why this matters:** a platform that can only be driven by a human clicking a form serves half
its users. The other half are pipelines — the CI job that provisions a bucket as part of standing
up a service — and engineers who live in a terminal. This step walks the same golden path as
step 3, with no browser involved, and shows that it is genuinely the *same* path: one
implementation, three surfaces.

## What was added

```
contracts/openapi.yaml     the contract — written first, and load-bearing at runtime
idp-core/                  the domain: validate, generate, submit a change, read state
  change.ts                ChangeRequest + the ChangeDriver port
  drivers/githubPr.ts        …its GitOps implementation (one commit, then a PR)
  drivers/dryRun.ts          …and one that renders without submitting
idp-portal/src/api/        the JSON surface, mounted on the same Express app as the HTML
idp-cli/                   the command line, typed from the contract
```

The important part is what did **not** change: `idp-gitops`, the workflows, and the policy gate
are untouched. A new surface was additive — which is the extensibility claim in
[PRD.md](../../PRD.md) tested for real.

### One change layer, three surfaces

Every write — from the form, the API or the CLI — builds the same `ChangeRequest` and hands it to
the same driver:

```
portal form ─┐
HTTP API ────┼──▶ planCreate/planUpdate/planDelete ──▶ ChangeDriver ──▶ one commit ──▶ PR
CLI ─────────┘         (idp-core, pure)                    │
                                                     DryRunDriver ──▶ rendered files, nothing opened
```

Before this, the portal derived branch names, PR titles and bodies inline in its two form
handlers. Now nothing outside `idp-core/src/change.ts` knows that a change is a pull request —
which is why swapping the mechanism later would not touch a single client.

---

## Do this — read the contract

```bash
npm run lint:api          # redocly, `recommended-strict`: any problem fails
open contracts/openapi.yaml
```

The spec is not documentation written after the fact. `express-openapi-validator` validates
requests **and responses** against it at runtime, so a handler that stops matching the contract
fails the test suite instead of shipping. The CLI's types are generated from the same file.

![The OpenAPI contract](images/08-openapi-contract.png)

---

## Do this — start the platform and list what exists

```bash
export GITHUB_REPO=edoatley/idp-prototype
export GITHUB_TOKEN=github_pat_...      # from your .env
npm run dev -w idp-portal               # serves the HTML UI *and* /v1 on :3000

export IDP_API_URL=http://localhost:3000
export IDP_TOKEN="$GITHUB_TOKEN"

./idp-cli/bin/idp.js bucket list
./idp-cli/bin/idp.js bucket describe edo-dev-platform-refactor-check
```

`describe` separates the settings a team may change from the guardrails the platform enforces —
so a developer can see the compliance posture they inherited without reading any Terraform.

![idp bucket describe](images/08-cli-describe.png)

---

## Do this — dry run, the reviewable diff before there is anything to review

```bash
./idp-cli/bin/idp.js bucket create \
  --name orders --team checkout --env dev --requester "$USER" \
  --retention-days 30 --label cost-centre=cc-1234 --dry-run
```

This prints the exact `main.tf` and `metadata.yaml` that would be committed, and opens nothing.
Note the generated Terraform is `fmt`-clean with the optional settings present: the alignment is
computed, because `pr.yml` runs `fmt -check` on every request.

![A dry run](images/08-cli-dry-run.png)

---

## Do this — open the request for real and follow it

```bash
./idp-cli/bin/idp.js bucket create \
  --name orders --team checkout --env dev --requester "$USER" --wait
```

The API answers **202 Accepted** with a `Request`, not a bucket — nothing is provisioned by an
API call alone. `--wait` then polls `GET /v1/requests/{id}`:

```
⏳ pending_review        # PR open, plan + policy gate running
🔄 merged                # you merged it; apply.yml is running
✅ applied               # the bucket exists
```

Status is resolved **live from the repo** — PR state, check runs, and the sticky audit comments
the workflows already post. There is no request database, so status cannot drift from reality.
`--wait` exits non-zero on `blocked` or `failed`, which is what makes it safe to put in a CI job.

![Following a request](images/08-cli-wait.png)

---

## Do this — change a bucket in place

```bash
./idp-cli/bin/idp.js bucket update edo-dev-checkout-orders --retention-days 30
```

Only the mutable settings can change. Identity (`name`, `owningTeam`, `environment`) is refused
with a 400 rather than ignored, because the bucket name is derived from it — "renaming" would
destroy and recreate the bucket and lose its data.

Open the PR the command printed: the plan should be an **in-place update**, not a replacement,
and the policy gate re-runs against the new settings. The retention rule only ever expires
*noncurrent* versions; both the module and an independent Rego rule refuse a lifecycle rule that
would delete live objects.

![An in-place update plan](images/08-update-plan.png)

---

## Do this — see that both surfaces agree

With the same platform running, open <http://localhost:3000/dashboard> and compare it with:

```bash
./idp-cli/bin/idp.js status
```

Same numbers, same inventory, one implementation underneath. That is the point of the shared
core: the oversight story does not fork per surface.

![Dashboard and CLI agreeing](images/08-parity.png)

---

**Next:** back to [the tour](README.md).
