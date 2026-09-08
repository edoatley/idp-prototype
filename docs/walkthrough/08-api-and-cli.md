# 8 · The API and CLI — the same golden path, without a browser

**Why this matters:** a platform that can only be driven by a human clicking a form serves half
its users. The other half are pipelines — the CI job that provisions a bucket as part of standing
up a service — and engineers who live in a terminal. This step walks the same golden path as
step 3, with no browser involved, and shows that it is genuinely the *same* path: one
implementation, three surfaces.

Everything below is **real output** from a single run on 2026-09-08: PRs
[#60](https://github.com/edoatley/idp-prototype/pull/60) (create),
[#61](https://github.com/edoatley/idp-prototype/pull/61) (update) and
[#62](https://github.com/edoatley/idp-prototype/pull/62) (decommission), which between them
provisioned, changed and destroyed a real bucket.

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
fails the test suite instead of shipping. The CLI's types are generated from the same file, and
CI fails on any diff between them.

> That gate has already earned its keep. When the API gained a `403` response, the request came
> back as a **500** — because `403` was not in the contract, and the validator refuses to emit an
> undocumented status. The contract was wrong, not the code.

![The OpenAPI contract](images/08-openapi-contract.png)

---

## Do this — start the platform and look around

From the **repo root**, in one terminal:

```bash
source .env                                      # defines IDP_PROTO_PORTAL_GHTOKEN
export GITHUB_REPO=edoatley/idp-prototype
export GITHUB_TOKEN="$IDP_PROTO_PORTAL_GHTOKEN"
npm run dev -w idp-portal                        # HTML UI *and* /v1 on :3000
```

In another, put the CLI on your PATH and point it at the running platform:

```bash
source .env                                      # ← easy to skip; see the warning below

# `npm ci` already linked the CLI into node_modules/.bin; this just makes
# `idp` resolvable. Without it you get "zsh: command not found: idp".
export PATH="$PWD/node_modules/.bin:$PATH"

export IDP_API_URL=http://localhost:3000
export IDP_TOKEN="$IDP_PROTO_PORTAL_GHTOKEN"

idp --version                                    # 0.1.0
[ -n "$IDP_TOKEN" ] && echo "token set"          # ← if this is silent, re-run `source .env`
```

> **Skipping `source .env` fails late, not early.** `IDP_TOKEN` becomes an empty string, and
> because reads need no credential, `idp bucket list` still works — the first *write* is where it
> surfaces, as `Error: Unauthorized`. The CLI notices when no token is configured at all and says
> so, but the check above catches it a step sooner.

> Prefer not to touch PATH? Every `idp` below works as `./idp-cli/bin/idp.js` instead. For an
> `idp` that outlives the shell, `npm link -w idp-cli` installs it globally.

```console
$ idp bucket list
BUCKET                           TEAM      ENV  CREATED     RETENTION  CLASS
-------------------------------  --------  ---  ----------  ---------  --------
edo-dev-platform-refactor-check  platform  dev  2026-09-04  keep all   STANDARD

$ idp bucket describe edo-dev-platform-refactor-check
bucket:        edo-dev-platform-refactor-check
team:          platform
environment:   dev
requested by:  edoatley
created:       2026-09-04
stack:         idp-gitops/stacks/dev/platform-refactor-check
request id:    req-20260904-platform-refactor-check-8amr

Settings (changeable):
  retention:      keep all versions
  storage class:  STANDARD
  extra labels:   none

Guardrails (enforced by the platform):
  location:        europe-west2
  uniform access:  true
  public access:   enforced
  versioning:      true
```

`describe` separates **what a team may change** from **what the platform enforces**, so a
developer can see the compliance posture they inherited without reading any Terraform.

---

## Do this — a dry run, before there is anything to review

```console
$ idp bucket create --name orders --team checkout --env dev \
    --retention-days 30 --label cost-centre=cc-1234 --dry-run
Dry run — nothing was opened.

create idp-gitops/stacks/dev/checkout-orders (2 files)

--- idp-gitops/stacks/dev/checkout-orders/main.tf ---
module "bucket" {
  source = "../../../modules/gcs-bucket"

  name           = "orders"
  owning_team    = "checkout"
  environment    = "dev"
  request_id     = "req-20260908-checkout-orders-w8sp"
  retention_days = 30
  extra_labels = {
    "cost-centre" = "cc-1234"
  }
}

--- idp-gitops/stacks/dev/checkout-orders/metadata.yaml ---
type: gcs-bucket
owning_team: checkout
environment: dev
request_id: req-20260908-checkout-orders-w8sp
requester: edoatley
created_at: "2026-09-08"
settings:
  retention_days: 30
  storage_class: STANDARD
  extra_labels:
    cost-centre: cc-1234
```

This is the exact content a real call would commit, and it opens nothing. Two details worth
noticing:

- The generated Terraform is **`fmt`-clean with the optional settings present**. `fmt` aligns runs
  of single-line arguments but gives an argument opening a block a single space, so the alignment
  is computed rather than templated — `pr.yml` runs `fmt -check` on every request.
- `requester: edoatley` is resolved **from the token**, not typed by the caller. A preview that
  named a placeholder author would differ from the thing itself, in the one feature whose whole
  purpose is that it does not.

### The platform says no before anything is opened

```console
$ idp bucket create --name orders --team nosuchteam --env dev
Error: Validation failed
  The request violates a platform convention.
  owning_team: owning_team must be a known team: payments, checkout, search, platform.

$ idp bucket create --name Not_Valid --team checkout --env dev
Error: Validation failed
  name: must match pattern "^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$"

$ idp bucket create --name refactor-check --team platform --env dev
Error: Conflict
  Bucket edo-dev-platform-refactor-check already exists.
```

Each exits non-zero. The first is a *platform* rule (the team registry), the second a *schema*
rule — different layers, one error shape.

---

## Do this — request it for real, and follow it

```console
$ idp bucket create --name orders --team checkout --env dev \
    --retention-days 30 --label cost-centre=cc-1234
request:  req-20260908-checkout-orders-1c4k
intent:   create
status:   ⏳ pending_review
bucket:   edo-dev-checkout-orders
stack:    idp-gitops/stacks/dev/checkout-orders
review:   https://github.com/edoatley/idp-prototype/pull/60
```

The API answers **202 Accepted** with a `Request`, not a bucket — nothing is provisioned by an API
call alone. The PR's plan shows the guardrails and the requested settings together:

```hcl
  # module.bucket.google_storage_bucket.this will be created
  + name                        = "edo-dev-checkout-orders"   # derived, not chosen
  + location                    = "EUROPE-WEST2"              # enforced
  + public_access_prevention    = "enforced"                  # enforced
  + uniform_bucket_level_access = true                        # enforced
  + versioning { enabled = true }                             # enforced
  + labels = {
      + "cost-centre" = "cc-1234"                             # the team's
      + "environment" = "dev"                                 # the platform's
      + "managed-by"  = "idp"
      + "owning-team" = "checkout"
      + "request-id"  = "req-20260908-checkout-orders-1c4k"
    }
  + lifecycle_rule {
      + action    { type = "Delete" }
      + condition { days_since_noncurrent_time = 30
                    with_state                 = "ARCHIVED" } # noncurrent only
    }
```

Merge it, and `--wait` follows the request to completion:

```console
$ idp request status req-20260908-checkout-orders-1c4k --wait
  🔄 merged
  ✅ applied
request:  req-20260908-checkout-orders-1c4k
intent:   create
status:   ✅ applied
bucket:   edo-dev-checkout-orders
review:   https://github.com/edoatley/idp-prototype/pull/60
$ echo $?
0
```

Status is resolved **live from the repo** — PR state, check runs, and the sticky audit comments
the workflows already post. There is no request database, so status cannot drift from reality.
`--wait` exits non-zero on `blocked` or `failed`, which is what makes it safe in a CI job.

> **It will happily wait forever, and that is the point.** During this capture a merge was missed,
> and `--wait` sat on `⏳ pending_review` for ten minutes rather than inventing progress. It polls
> the repo instead of tracking its own optimistic state, so "nobody has merged this yet" is a
> thing it can actually say. There is no `--timeout` yet; in a pipeline you rely on the job's own.

The bucket is real, and GCS states the retention rule's scope in its own words:

```console
$ gcloud storage buckets describe gs://edo-dev-checkout-orders
labels:
  cost-centre: cc-1234
  environment: dev
  managed-by: idp
  owning-team: checkout
  request-id: req-20260908-checkout-orders-1c4k
lifecycle_config:
  rule:
  - action: {type: AbortIncompleteMultipartUpload}
    condition: {age: 7}
  - action: {type: Delete}
    condition: {daysSinceNoncurrentTime: 30, isLive: false}   # ← cannot touch live objects
location: EUROPE-WEST2
public_access_prevention: enforced
uniform_bucket_level_access: true
```

`isLive: false` is the guardrail that matters most: the module asserts it, an independent Rego
rule re-checks it, and the cloud confirms it. Deleting live data is the one bucket change that
cannot be undone.

---

## Do this — change a bucket in place

Identity is immutable — the bucket name is derived from it, so "renaming" would destroy and
recreate the bucket. The platform **refuses rather than silently ignoring**:

```console
$ curl -X PATCH .../v1/buckets/edo-dev-checkout-orders -d '{"owningTeam":"payments"}'
400 {"title":"Validation failed",
     "errors":[{"field":"owningTeam","message":"must NOT have additional properties"}]}
```

The mutable settings do change, and the plan proves it changes **in place**:

```console
$ idp bucket update edo-dev-checkout-orders --storage-class NEARLINE --retention-days 90
request:  req-20260908-checkout-orders-eaya
intent:   update
status:   ⏳ pending_review
review:   https://github.com/edoatley/idp-prototype/pull/61
```

```hcl
  # module.bucket.google_storage_bucket.this will be updated in-place
  ~ storage_class = "STANDARD" -> "NEARLINE"
  ~ lifecycle_rule { ... }

Plan: 0 to add, 1 to change, 0 to destroy.
```

**`0 to destroy`** is the whole reason the module has mutable inputs at all: a bucket with data in
it survives a settings change. The policy gate re-runs against the new settings.

![The in-place update plan](images/08-update-plan.png)

After merging, the inventory record shows attribution and provenance kept apart:

```yaml
request_id: req-20260908-checkout-orders-1c4k   # the CREATE's id — provenance, untouched
requester:  edoatley                            # who the bucket is for
updated_at: "2026-09-08"
updated_by: edoatley                            # resolved from the token, not self-declared
settings:
  retention_days: 90
  storage_class: NEARLINE
```

### One writer at a time

Open a second change against the same bucket and the platform refuses:

```console
$ idp bucket update edo-dev-checkout-orders --retention-days 5
Error: Conflict
  A delete request (req-20260908-checkout-decommission-lwnc) is already open against
  edo-dev-checkout-orders: https://github.com/edoatley/idp-prototype/pull/62.
  Merge or close it first.
```

Two open changes would race on shared Terraform state, and the second would be planned against a
base that no longer reflects the first. The check above is the courteous one — it names the
conflicting request. The *guarantee* is the branch itself: branch names are deterministic per
intent and stack, so GitHub refusing a ref that already exists cannot be raced.

---

## Do this — see that both surfaces agree

```console
$ idp status
Delivery
  apply success rate:  100% (11/11)
  median lead time:    4 min

Compliance
  policy pass rate:  85% (11/13)
  open drift:        none
```

Open <http://localhost:3000/dashboard> beside it: same inventory, same 100%, same 4 minutes. One
implementation underneath — the oversight story does not fork per surface. (The 85% policy pass
rate is the gate working: the failures are the deliberately non-compliant PRs from step 4.)

![Dashboard and CLI agreeing](images/08-parity.png)

---

## Do this — decommission it

```console
$ idp bucket delete edo-dev-checkout-orders --dry-run
Dry run — nothing was opened.

remove idp-gitops/stacks/dev/checkout-orders (2 files)

--- idp-gitops/stacks/dev/checkout-orders/main.tf (removed) ---
--- idp-gitops/stacks/dev/checkout-orders/metadata.yaml (removed) ---

$ idp bucket delete edo-dev-checkout-orders
request:  req-20260908-checkout-decommission-lwnc
intent:   delete
status:   ⏳ pending_review
review:   https://github.com/edoatley/idp-prototype/pull/62
```

On the decommission PR the `plan` job reports **`skipping`** — a removed stack has nothing to
plan, and `destroy.yml` takes over on merge. Apply and destroy are deliberately disjoint
pipelines (step 7).

```console
$ idp request status req-20260908-checkout-decommission-lwnc --wait
  ♻️ decommissioned

$ gcloud storage buckets describe gs://edo-dev-checkout-orders
ERROR: gs://edo-dev-checkout-orders not found: 404.

$ idp bucket list
BUCKET                           TEAM      ENV  CREATED     RETENTION  CLASS
-------------------------------  --------  ---  ----------  ---------  --------
edo-dev-platform-refactor-check  platform  dev  2026-09-04  keep all   STANDARD
```

Requested, provisioned, changed in place and destroyed — **without opening a browser, and without
anyone writing Terraform**. Every step is an auditable PR, every change passed the same policy
gate, and the inventory never disagreed with the cloud.

---

**Next:** back to [the tour](README.md).
