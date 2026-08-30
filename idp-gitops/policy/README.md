# policy: the compliance gate (Phase 2)

Rego policies run by [Conftest](https://www.conftest.dev/) against `terraform show -json` in
PR CI. They are the **independent second layer** of the golden path: the `gcs-bucket` module
*prevents* misconfiguration by construction, and this gate *detects* it in the plan — so a
stack that calls the raw `google_storage_bucket` and bypasses the module is still blocked.

## What it enforces

For every `google_storage_bucket` in the plan (`resource_changes[].change.after`):

- `public_access_prevention == "enforced"` (blocks public buckets — the headline)
- `uniform_bucket_level_access == true`
- versioning enabled
- `location == europe-west2`
- the four mandatory labels present + `managed-by == idp`
- `name` prefixed `edo-`

Any violation is a `deny` message; Conftest exits non-zero and the PR check goes red.

## Run it

```bash
# Unit tests (credential-free) — inlined fixtures in gcs_bucket_test.rego
conftest verify --policy idp-gitops/policy

# Manual: evaluate a captured plan JSON (the module-bypass case fails)
conftest test idp-gitops/policy/testdata/public_bucket.json --policy idp-gitops/policy
conftest test idp-gitops/policy/testdata/compliant.json    --policy idp-gitops/policy
```

`conftest verify` runs in the `terraform-checks` CI (and `scripts/checks.sh`); the live gate
against a real PR plan runs in `pr.yml` (Phase 2, PR2).
