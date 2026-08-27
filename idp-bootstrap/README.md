# idp-bootstrap (Phase 0)

One-time Terraform that stands up the GCP + CI foundations everything else builds on:

- a dedicated GCP project (`idp-prototype-edo`) linked to billing,
- required APIs enabled,
- a **GCS bucket for remote Terraform state** (used by `idp-gitops`),
- **Workload Identity Federation** trusting GitHub Actions for `edoatley/idp-prototype` (keyless — no SA keys),
- a least-privilege **CI service account** (`idp-ci`) that GitHub Actions impersonates.

This config runs with **local state on purpose** — it creates the very bucket that later
state lives in. Keep the resulting `terraform.tfstate` (gitignored) so you can manage these
foundations later.

## Prerequisites
- `terraform` >= 1.5, `gcloud`, and (optional) `gh`.
- You are logged in and have Application Default Credentials:
  ```
  gcloud auth login
  gcloud auth application-default login
  ```
- Permission to create projects and link the billing account.

## Run it
```
cp terraform.tfvars.example terraform.tfvars   # edit if needed
./bootstrap.sh                                 # init + plan + (confirmed) apply
# or, to inspect without applying:
./bootstrap.sh --plan-only
```

`bootstrap.sh` will not create anything until you confirm at the prompt.

## After apply — wire GitHub
The outputs are **non-secret** (WIF is keyless), so publish them as GitHub Actions
**repository variables** on `edoatley/idp-prototype`:

| GitHub variable | From output |
|---|---|
| `GCP_PROJECT_ID` | `project_id` |
| `GCP_REGION` | `region` |
| `TFSTATE_BUCKET` | `tfstate_bucket` |
| `GCP_SERVICE_ACCOUNT` | `ci_service_account` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `workload_identity_provider` |

Automate it with:
```
./bootstrap.sh --set-github-vars       # after a successful apply (needs gh)
```

## Exit criteria (Phase 0 done)
A hello-world GitHub Action can `terraform apply` a bucket into the project **via WIF, with
no stored keys** — see the smoke-test workflow added at the end of Phase 0.
