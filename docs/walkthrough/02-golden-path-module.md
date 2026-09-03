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

Then skim the enforcement in [`main.tf`](../../idp-gitops/modules/gcs-bucket/main.tf), and run
the full credential-free suite from the repo root:

```bash
./scripts/checks.sh    # fmt / validate / test / tflint / trivy / conftest verify
```

## What's happening & why

The `terraform test` suite runs against a **mocked Google provider** — fast, credential-free, and
CI-friendly — asserting each guardrail is actually wired so a future edit can't silently weaken
it. This is the "prevent" half of a two-layer model (the policy gate in step 4 is the independent
"detect" half). `scripts/checks.sh` is the exact set of gates CI runs, so you can catch
everything before pushing.

![terraform test — all guardrail assertions passing](images/02-terraform-test.png)

![scripts/checks.sh green across module + policy (fmt/validate/test/tflint/trivy/conftest)](images/02-checks-green.png)

## Reference links

- Module + tests: [`modules/gcs-bucket/`](../../idp-gitops/modules/gcs-bucket/)
- PRs: [#7 module + tests](https://github.com/edoatley/idp-prototype/pull/7),
  [#8 security scanning + test-gap fix](https://github.com/edoatley/idp-prototype/pull/8)

---
Next: [3 — Request a bucket via the portal →](03-request-via-portal.md)
