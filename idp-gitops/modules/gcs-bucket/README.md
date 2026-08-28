# module: gcs-bucket (Phase 1)

The opinionated, guardrailed Terraform module behind the IDP golden path. A developer
picks very little — `name`, `owning_team`, `environment` — and the module enforces every
safe default. It is called by per-request stacks under
`idp-gitops/stacks/<env>/<team>-<name>/`.

## Enforced guardrails (non-overridable)

- **Region**: `europe-west2` (London).
- **Uniform bucket-level access**: on.
- **Public access prevention**: `enforced`.
- **Versioning**: on.
- **`force_destroy`**: `false` (guards against destroying a non-empty bucket).
- **Lifecycle**: aborts incomplete multipart uploads after 7 days.
- **Deterministic name**: `edo-<environment>-<owning_team>-<name>` (lowercased, length-validated 3–63).
- **Mandatory labels**: `owning-team`, `environment`, `managed-by=idp`, `request-id`.

`owning_team` is validated against `platform/teams.yaml` via a resource precondition
(variable `validation` blocks cannot read files). The Phase 2 policy gate re-checks these
same invariants independently.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Developer-chosen trailing segment (3–30 lowercase chars). |
| `owning_team` | string | yes | Team id; must exist in `platform/teams.yaml`. |
| `environment` | string | yes | One of `dev`, `test`, `prod`. |
| `request_id` | string | yes | Provisioning-request id; recorded as the `request-id` label. |
| `project_id` | string | no | GCP project (default `idp-prototype-edo`). |
| `teams_file` | string | no | Override path to the teams registry (default `../../platform/teams.yaml`). |

## Outputs

`bucket_name`, `bucket_url`, `bucket_self_link`, `labels`.

## Testing

```
terraform init -backend=false
terraform test          # mock_provider "google" — no cloud, no credentials
```

Asserts the enforced defaults and that invalid inputs (unknown team, bad environment,
malformed name) are rejected. Also runs in CI via the `terraform-checks` workflow matrix.
