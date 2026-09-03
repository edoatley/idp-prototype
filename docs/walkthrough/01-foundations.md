# 1 — Foundations: project, keyless WIF, state, CI

*(Phase 0 — `idp-bootstrap/`)*

Before any self-service, a one-time Terraform run stood up the GCP + CI foundations everything
else builds on. It runs with **local state on purpose** — it creates the very bucket remote
state later lives in.

## What exists

| Thing | Value |
|---|---|
| GCP project | `idp-prototype-edo` (region `europe-west2`) |
| Terraform state bucket | `idp-prototype-edo-tfstate` (one prefix per request) |
| CI service account | `idp-ci@idp-prototype-edo.iam.gserviceaccount.com` (`roles/storage.admin`) |
| WIF provider | `projects/734077548565/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| WIF trust | scoped to repo `edoatley/idp-prototype` |

## Do this

- **GCP project** — open the console: `gcloud projects describe idp-prototype-edo`, or the
  [console dashboard](https://console.cloud.google.com/home/dashboard?project=idp-prototype-edo).
- **Keyless WIF** — the [Workload Identity pool](https://console.cloud.google.com/iam-admin/workload-identity-pools?project=idp-prototype-edo)
  (`github-pool` → `github-provider`) trusting GitHub Actions OIDC, scoped to this repo.
- **State bucket** — `gcloud storage buckets describe gs://idp-prototype-edo-tfstate`.
- **Repo variables** — GitHub → the repo → Settings → Secrets and variables → Actions →
  **Variables**: `GCP_PROJECT_ID`, `GCP_REGION`, `TFSTATE_BUCKET`, `GCP_SERVICE_ACCOUNT`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER`.

## What's happening & why

**Keyless auth is the headline.** There are **no service-account keys** anywhere — GitHub Actions
mints a short-lived OIDC token that GCP's Workload Identity Federation exchanges for scoped,
temporary credentials, and only for *this* repository. Nothing long-lived to leak or rotate. The
CI service account holds least privilege (`roles/storage.admin`) for the bucket use-case. The
bootstrap outputs are published as **repo variables** (not secrets) because none of them are
sensitive — which is itself a consequence of going keyless.

![GCP project dashboard for idp-prototype-edo](images/01-gcp-project.png)

![Workload Identity pool + provider (github-pool / github-provider), scoped to the repo](images/01-wif-pool.png)

![GitHub Actions repository variables (GCP_PROJECT_ID, WIF provider, etc.)](images/01-repo-variables.png)

## Reference links

- Bootstrap code & runbook: [`idp-bootstrap/`](../../idp-bootstrap/README.md)
- Foundations PRs: [#4 tests](https://github.com/edoatley/idp-prototype/pull/4),
  [#5 runner](https://github.com/edoatley/idp-prototype/pull/5),
  [#6 WIF hardening](https://github.com/edoatley/idp-prototype/pull/6)

---
Next: [2 — The golden-path module →](02-golden-path-module.md)
