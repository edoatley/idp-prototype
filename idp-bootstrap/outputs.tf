# These outputs are non-secret (WIF is keyless). Publish them as GitHub Actions
# *repository variables* on edoatley/idp-prototype so workflows can authenticate.

output "project_id" {
  description = "GitHub var: GCP_PROJECT_ID"
  value       = google_project.idp.project_id
}

output "region" {
  description = "GitHub var: GCP_REGION"
  value       = var.region
}

output "tfstate_bucket" {
  description = "GitHub var: TFSTATE_BUCKET (backend for idp-gitops)"
  value       = google_storage_bucket.tfstate.name
}

output "ci_service_account" {
  description = "GitHub var: GCP_SERVICE_ACCOUNT"
  value       = google_service_account.ci.email
}

output "workload_identity_provider" {
  description = "GitHub var: GCP_WORKLOAD_IDENTITY_PROVIDER (full resource name for google-github-actions/auth)"
  value       = google_iam_workload_identity_pool_provider.github.name
}
