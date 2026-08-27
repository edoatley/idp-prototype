# Keyless auth: GitHub Actions OIDC -> Workload Identity Federation -> CI service
# account. No long-lived service-account keys are ever created or stored.

# google_project_service reports "enabled" before iam.googleapis.com is actually
# serving, so creating a WIF pool immediately after can race and fail with a
# transient 403. Wait a short while after enabling APIs before touching WIF.
resource "time_sleep" "wait_for_apis" {
  depends_on      = [google_project_service.enabled]
  create_duration = "60s"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.idp.project_id
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"
  description               = "Trusts GitHub Actions OIDC tokens for the IDP repo."

  depends_on = [time_sleep.wait_for_apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.idp.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens from this exact repository are accepted.
  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# The identity GitHub Actions impersonates to run terraform apply.
resource "google_service_account" "ci" {
  project      = google_project.idp.project_id
  account_id   = "idp-ci"
  display_name = "IDP CI (Terraform apply via GitHub Actions)"

  depends_on = [google_project_service.enabled]
}

# Least-privilege for the bucket use-case: manage GCS (buckets + the state bucket).
# Broaden per capability as new resource types are added.
resource "google_project_iam_member" "ci_storage_admin" {
  project = google_project.idp.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# Allow only the trusted repo (any branch) to impersonate the CI service account.
resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
