# Opinionated, guardrailed GCS bucket for the IDP golden path.
#
# Non-overridable guardrails enforced below:
#   - region europe-west2 (London)
#   - uniform bucket-level access
#   - public access prevention = enforced
#   - versioning on
#   - force_destroy = false
#   - mandatory labels: owning-team, environment, managed-by=idp, request-id
#   - deterministic name: edo-<environment>-<team>-<name> (lowercased)
#
# The policy gate (Phase 2) is a second, independent check on these same invariants.

locals {
  # Enforced region — deliberately not a variable.
  location = "europe-west2"

  # teams_file defaults to the repo's platform registry, relative to this module.
  teams_file  = var.teams_file != "" ? var.teams_file : "${path.module}/../../platform/teams.yaml"
  valid_teams = [for t in yamldecode(file(local.teams_file)).teams : t.id]

  # Deterministic, guardrailed name.
  bucket_name = lower("edo-${var.environment}-${var.owning_team}-${var.name}")

  # Mandatory inventory/ownership labels.
  mandatory_labels = {
    "owning-team" = var.owning_team
    "environment" = var.environment
    "managed-by"  = "idp"
    "request-id"  = var.request_id
  }

  # A team's own labels, then the platform's — so the mandatory four always win.
  # var.extra_labels already rejects these keys; this ordering means a mistake
  # there could still never strip the platform's ownership trail.
  labels = merge(var.extra_labels, local.mandatory_labels)
}

resource "google_storage_bucket" "this" {
  project  = var.project_id
  name     = local.bucket_name
  location = local.location

  storage_class = var.storage_class

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Guard against accidental data loss on `terraform destroy` of a non-empty bucket.
  force_destroy = false

  versioning {
    enabled = true
  }

  # Sensible default hygiene: clean up abandoned multipart uploads.
  lifecycle_rule {
    action {
      type = "AbortIncompleteMultipartUpload"
    }
    condition {
      age = 7
    }
  }

  # Optional retention: expire NONCURRENT versions only. Live objects are never
  # deleted by the platform — with versioning on, this reclaims the history a
  # team does not need without ever destroying data it can still see.
  dynamic "lifecycle_rule" {
    for_each = var.retention_days == null ? [] : [var.retention_days]

    content {
      action {
        type = "Delete"
      }
      condition {
        days_since_noncurrent_time = lifecycle_rule.value
        with_state                 = "ARCHIVED"
      }
    }
  }

  labels = local.labels

  lifecycle {
    precondition {
      condition     = contains(local.valid_teams, var.owning_team)
      error_message = "owning_team '${var.owning_team}' is not a known team in ${local.teams_file}. Valid teams: ${join(", ", local.valid_teams)}."
    }
    precondition {
      condition     = length(local.bucket_name) >= 3 && length(local.bucket_name) <= 63
      error_message = "Derived bucket name '${local.bucket_name}' must be 3-63 characters; shorten the 'name' input."
    }
  }
}
