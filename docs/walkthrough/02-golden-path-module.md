# 2 — The golden-path module & its guardrail tests

*(Phase 1 — `idp-gitops/modules/gcs-bucket/`)*

The opinionated, guardrailed Terraform module is the **primary guardrail**. A developer picks
three things (`name`, `owning_team`, `environment`); the module makes the safe config the *only*
config.

## What it enforces (non-overridable)

- Region `europe-west2`, **uniform bucket-level access**, **public-access-prevention = enforced**,
  **versioning on**, `force_destroy = false`, an abort-incomplete-multipart lifecycle rule.
- Deterministic name `edo-<env>-<team>-<name>`; mandatory labels `owning-team`, `environment`,
  `managed-by=idp`, `request-id`.
- `owning_team` validated against [`platform/teams.yaml`](../../idp-gitops/platform/teams.yaml)
  via a resource precondition.

## Do this

```bash
cd idp-gitops/modules/gcs-bucket
terraform init -backend=false && terraform test    # mock_provider — no cloud, no creds
```

giving

```terminaloutput
Terraform has been successfully initialized!

You may now begin working with Terraform. Try running "terraform plan" to see
any changes that are required for your infrastructure. All Terraform commands
should now work.

If you ever set or change modules or backend configuration for Terraform,
rerun this command to reinitialize your working directory. If you forget, other
commands will detect it and remind you to do so if necessary.
tests/gcs-bucket.tftest.hcl... in progress
  run "defaults_are_compliant"... pass
  run "rejects_unknown_team"... pass
  run "rejects_invalid_environment"... pass
  run "rejects_invalid_name"... pass
tests/gcs-bucket.tftest.hcl... tearing down
tests/gcs-bucket.tftest.hcl... pass

Success! 4 passed, 0 failed.
```

Then skim the enforcement in [`main.tf`](../../idp-gitops/modules/gcs-bucket/main.tf), and run
the full credential-free suite from the repo root:

```bash
./scripts/checks.sh    # fmt / validate / test / tflint / trivy / conftest verify
```

giving

```terminaloutput
===================================================================
== idp-bootstrap
===================================================================
-- terraform fmt
-- terraform init (no backend)
-- terraform validate
Success! The configuration is valid.

-- terraform test (mock provider)
tests/bootstrap.tftest.hcl... in progress
  run "defaults_are_compliant"... pass
  run "rejects_invalid_github_repo"... pass
  run "rejects_invalid_project_id"... pass
tests/bootstrap.tftest.hcl... tearing down
tests/bootstrap.tftest.hcl... pass

Success! 3 passed, 0 failed.
-- tflint
-- trivy config (misconfig scan; honours .trivyignore)

Report Summary

┌──────────┬───────────┬───────────────────┐
│  Target  │   Type    │ Misconfigurations │
├──────────┼───────────┼───────────────────┤
│ .        │ terraform │         0         │
├──────────┼───────────┼───────────────────┤
│ main.tf  │ terraform │         0         │
├──────────┼───────────┼───────────────────┤
│ state.tf │ terraform │         0         │
└──────────┴───────────┴───────────────────┘
Legend:
- '-': Not scanned
- '0': Clean (no security findings detected)

-- OK: idp-bootstrap

===================================================================
== idp-gitops/modules/gcs-bucket
===================================================================
-- terraform fmt
-- terraform init (no backend)
-- terraform validate
Success! The configuration is valid.

-- terraform test (mock provider)
tests/gcs-bucket.tftest.hcl... in progress
  run "defaults_are_compliant"... pass
  run "rejects_unknown_team"... pass
  run "rejects_invalid_environment"... pass
  run "rejects_invalid_name"... pass
tests/gcs-bucket.tftest.hcl... tearing down
tests/gcs-bucket.tftest.hcl... pass

Success! 4 passed, 0 failed.
-- tflint
-- trivy config (misconfig scan; honours .trivyignore)

Report Summary

┌─────────┬───────────┬───────────────────┐
│ Target  │   Type    │ Misconfigurations │
├─────────┼───────────┼───────────────────┤
│ .       │ terraform │         0         │
├─────────┼───────────┼───────────────────┤
│ main.tf │ terraform │         0         │
└─────────┴───────────┴───────────────────┘
Legend:
- '-': Not scanned
- '0': Clean (no security findings detected)

-- OK: idp-gitops/modules/gcs-bucket

===================================================================
== idp-gitops/policy (conftest verify)
===================================================================

10 tests, 10 passed, 0 warnings, 0 failures, 0 exceptions, 0 skipped
-- OK: idp-gitops/policy

All checks passed.
```

## What's happening & why

The `terraform test` suite runs against a **mocked Google provider** — fast, credential-free, and
CI-friendly — asserting each guardrail is actually wired so a future edit can't silently weaken
it. This is the "prevent" half of a two-layer model (the policy gate in step 4 is the independent
"detect" half). `scripts/checks.sh` is the exact set of gates CI runs, so you can catch
everything before pushing.

## Reference links

- Module + tests: [`modules/gcs-bucket/`](../../idp-gitops/modules/gcs-bucket/)
- PRs: [#7 module + tests](https://github.com/edoatley/idp-prototype/pull/7),
  [#8 security scanning + test-gap fix](https://github.com/edoatley/idp-prototype/pull/8)

---
Next: [3 — Request a bucket via the portal →](03-request-via-portal.md)
