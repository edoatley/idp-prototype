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

# --- Mutable settings ------------------------------------------------------
# The knobs a team may turn. Each test pins BOTH that the knob works and that it
# cannot be used to escape a guardrail — the reason these are the only ones open.

run "settings_default_to_the_opinionated_choice" {
  command = plan

  assert {
    condition     = google_storage_bucket.this.storage_class == "STANDARD"
    error_message = "storage_class must default to STANDARD."
  }
  # Only the multipart-abort rule; no retention rule unless one is asked for.
  assert {
    condition     = length(google_storage_bucket.this.lifecycle_rule) == 1
    error_message = "With no retention_days there must be exactly one lifecycle rule (the multipart abort)."
  }
}

run "retention_expires_only_noncurrent_versions" {
  command = plan

  variables {
    retention_days = 30
  }

  assert {
    condition     = length(google_storage_bucket.this.lifecycle_rule) == 2
    error_message = "retention_days must add a second lifecycle rule."
  }
  # The whole point: the Delete action must be scoped to ARCHIVED (noncurrent)
  # objects. A rule deleting LIVE objects would silently destroy a team's data.
  assert {
    condition = alltrue([
      for r in google_storage_bucket.this.lifecycle_rule :
      one(r.condition).with_state == "ARCHIVED" if one(r.action).type == "Delete"
    ])
    error_message = "A Delete lifecycle rule must only ever apply to ARCHIVED (noncurrent) versions."
  }
  assert {
    condition = anytrue([
      for r in google_storage_bucket.this.lifecycle_rule :
      one(r.condition).days_since_noncurrent_time == 30
    ])
    error_message = "retention_days must set days_since_noncurrent_time."
  }
}

run "extra_labels_are_merged_without_displacing_the_mandatory_ones" {
  command = plan

  variables {
    extra_labels = {
      "cost-centre" = "cc-1234"
    }
  }

  assert {
    condition     = google_storage_bucket.this.labels["cost-centre"] == "cc-1234"
    error_message = "extra_labels must be applied to the bucket."
  }
  assert {
    condition     = google_storage_bucket.this.labels["managed-by"] == "idp"
    error_message = "extra_labels must not displace the mandatory managed-by label."
  }
  assert {
    condition     = google_storage_bucket.this.labels["owning-team"] == "platform"
    error_message = "extra_labels must not displace the mandatory owning-team label."
  }
}

run "storage_class_outside_the_allowlist_is_rejected" {
  command = plan

  variables {
    storage_class = "ARCHIVE"
  }

  expect_failures = [var.storage_class]
}

run "extra_labels_cannot_shadow_a_platform_label" {
  command = plan

  variables {
    extra_labels = {
      "managed-by" = "not-idp"
    }
  }

  expect_failures = [var.extra_labels]
}

run "retention_days_outside_the_permitted_range_is_rejected" {
  command = plan

  variables {
    retention_days = 0
  }

  expect_failures = [var.retention_days]
}
