# 5 — Merge → apply via WIF + the audit trail

*(Phase 1 + audit — `.github/workflows/apply.yml`)*

Merging the PR provisions the real bucket, and the result is posted back onto the PR so the loop is
closed and auditable.

## Do this

Merge the PR from step 3. Then watch:

```bash
gh run watch $(gh run list --workflow=apply.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

- The **apply run** (`detect` → `apply (…stack…)`).
- The **`✅ Applied`** comment `apply.yml` adds to the PR (bucket name, outputs, run link).
- The **live bucket**:

```bash
gcloud storage buckets describe gs://edo-dev-<team>-<name> \
  --format="value(name,location,uniform_bucket_level_access,public_access_prevention,versioning_enabled)"
```

## What's happening & why

On merge to `main`, `apply.yml` detects the changed stack, authenticates via **keyless WIF**, and
runs `terraform apply`. State lands under the stack's own prefix in `idp-prototype-edo-tfstate`
(isolated blast radius). The bucket comes up with every guardrail enforced. Because apply runs on
*push* (not the PR), it finds the originating PR and posts an **audit comment** — so "what was
provisioned, by which run" is visible where the request was made. The authoritative trail remains
the immutable Actions run + GCP audit logs + `metadata.yaml`.

![apply.yml run — provisioning via WIF](images/05-apply-run.png)

![The ✅ Applied audit comment on the PR (bucket + outputs + run link)](images/05-apply-comment.png)

![The live bucket — UBLA / public-access-prevention=enforced / versioning / labels](images/05-live-bucket.png)

## Reference links

- Workflow: [`apply.yml`](../../.github/workflows/apply.yml)
- Audit comment on a real PR: [#31 (✅ Applied edo-dev-search-index)](https://github.com/edoatley/idp-prototype/pull/31)
- PR: [#23 apply audit comment](https://github.com/edoatley/idp-prototype/pull/23)

---
Next: [6 — The oversight dashboard →](06-oversight-dashboard.md)
