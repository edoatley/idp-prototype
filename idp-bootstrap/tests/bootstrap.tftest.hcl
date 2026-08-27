# Unit tests for the bootstrap foundations using a MOCKED Google provider.
# Runs with no cloud access and no credentials:
#   terraform init -backend=false && terraform test
# Asserts the security guardrails are actually wired, so a future edit can't
# silently weaken them.

mock_provider "google" {}

variables {
  # billing_account has no default; supply a dummy so plan can run.
  billing_account = "000000-000000-000000"
}

run "defaults_are_compliant" {
  command = plan

  # --- State bucket hardening ---
  assert {
    condition     = google_storage_bucket.tfstate.uniform_bucket_level_access == true
    error_message = "State bucket must enforce uniform bucket-level access."
  }
  assert {
    condition     = google_storage_bucket.tfstate.public_access_prevention == "enforced"
    error_message = "State bucket must enforce public access prevention."
  }
  assert {
    condition     = google_storage_bucket.tfstate.versioning[0].enabled == true
    error_message = "State bucket must have versioning enabled."
  }
  assert {
    condition     = google_storage_bucket.tfstate.force_destroy == false
    error_message = "State bucket must not be force-destroyable."
  }

  # --- Workload Identity Federation scope ---
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.repository == 'edoatley/idp-prototype'"
    error_message = "WIF provider must be scoped to the edoatley/idp-prototype repository."
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.oidc[0].issuer_uri == "https://token.actions.githubusercontent.com"
    error_message = "WIF provider must trust the GitHub Actions OIDC issuer."
  }

  # --- CI service account: least privilege ---
  assert {
    condition     = google_project_iam_member.ci_storage_admin.role == "roles/storage.admin"
    error_message = "CI service account should hold only roles/storage.admin at project level."
  }
  assert {
    condition     = google_service_account.ci.account_id == "idp-ci"
    error_message = "CI service account id should be idp-ci."
  }
}

run "rejects_invalid_github_repo" {
  command = plan

  variables {
    github_repo = "not-a-valid-repo"
  }

  expect_failures = [var.github_repo]
}

run "rejects_invalid_project_id" {
  command = plan

  variables {
    project_id = "Invalid_Project_ID"
  }

  expect_failures = [var.project_id]
}
