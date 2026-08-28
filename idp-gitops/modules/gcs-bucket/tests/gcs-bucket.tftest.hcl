# Unit tests for the gcs-bucket guardrails using a MOCKED Google provider.
# Runs with no cloud access and no credentials:
#   terraform init -backend=false && terraform test
# Asserts the enforced defaults are actually wired, so a future edit can't
# silently weaken them.

mock_provider "google" {}

variables {
  name        = "demo"
  owning_team = "platform" # exists in ../../platform/teams.yaml
  environment = "dev"
  request_id  = "req-000000"
}

run "defaults_are_compliant" {
  command = plan

  assert {
    condition     = google_storage_bucket.this.name == "edo-dev-platform-demo"
    error_message = "Bucket name must be the deterministic edo-<env>-<team>-<name>."
  }
  assert {
    condition     = google_storage_bucket.this.location == "europe-west2"
    error_message = "Bucket must be pinned to europe-west2."
  }
  assert {
    condition     = google_storage_bucket.this.uniform_bucket_level_access == true
    error_message = "Bucket must enforce uniform bucket-level access."
  }
  assert {
    condition     = google_storage_bucket.this.public_access_prevention == "enforced"
    error_message = "Bucket must enforce public access prevention."
  }
  assert {
    condition     = google_storage_bucket.this.versioning[0].enabled == true
    error_message = "Bucket must have versioning enabled."
  }
  assert {
    condition     = google_storage_bucket.this.force_destroy == false
    error_message = "Bucket must not be force-destroyable."
  }
  # lifecycle_rule / action / condition are sets — use one() to read the single element.
  assert {
    condition     = one(one(google_storage_bucket.this.lifecycle_rule).action).type == "AbortIncompleteMultipartUpload"
    error_message = "Bucket must have a lifecycle rule aborting incomplete multipart uploads."
  }
  assert {
    condition     = one(one(google_storage_bucket.this.lifecycle_rule).condition).age == 7
    error_message = "Incomplete-multipart-upload abort must trigger at age 7 days."
  }

  # --- Mandatory labels ---
  assert {
    condition     = google_storage_bucket.this.labels["owning-team"] == "platform"
    error_message = "Bucket must carry the owning-team label."
  }
  assert {
    condition     = google_storage_bucket.this.labels["environment"] == "dev"
    error_message = "Bucket must carry the environment label."
  }
  assert {
    condition     = google_storage_bucket.this.labels["managed-by"] == "idp"
    error_message = "Bucket must carry managed-by=idp."
  }
  assert {
    condition     = google_storage_bucket.this.labels["request-id"] == "req-000000"
    error_message = "Bucket must carry the request-id label."
  }
}

run "rejects_unknown_team" {
  command = plan

  variables {
    owning_team = "ghosts" # passes format validation but absent from teams.yaml
  }

  expect_failures = [google_storage_bucket.this]
}

run "rejects_invalid_environment" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}

run "rejects_invalid_name" {
  command = plan

  variables {
    name = "Bad_Name"
  }

  expect_failures = [var.name]
}
