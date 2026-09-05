# Developer-facing inputs for a golden-path GCS bucket. The developer picks very
# little (name, owning_team, environment); everything else is enforced by the
# module (see main.tf) and cannot be overridden.

variable "name" {
  description = "Short bucket name chosen by the developer (the trailing segment of the deterministic bucket name)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$", var.name))
    error_message = "name must be 3-30 chars, lowercase letters/digits/hyphens, starting and ending with a letter or digit."
  }
}

variable "owning_team" {
  description = "Team id that owns this bucket. Must exist in platform/teams.yaml (enforced via precondition in main.tf)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.owning_team))
    error_message = "owning_team must be lowercase letters/digits/hyphens and start with a letter."
  }
}

variable "environment" {
  description = "Deployment environment for this bucket."
  type        = string

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be one of: dev, test, prod."
  }
}

variable "request_id" {
  description = "Unique id for the provisioning request (recorded as the mandatory request-id label and in the stack's metadata.yaml)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9_-]{1,63}$", var.request_id))
    error_message = "request_id must be 1-63 chars of lowercase letters, digits, underscores or hyphens (GCS label-value charset)."
  }
}

variable "project_id" {
  description = "GCP project that owns the bucket."
  type        = string
  default     = "idp-prototype-edo"
}

variable "teams_file" {
  description = "Path to the platform teams registry used to validate owning_team. Defaults to the repo's platform/teams.yaml; overridable for tests/portal."
  type        = string
  default     = "" # resolved to ${path.module}/../../platform/teams.yaml in main.tf when empty
}

# --- Mutable settings ------------------------------------------------------
# The only inputs a team may change after provisioning. Everything above is
# identity (it determines the bucket name, so changing it would replace the
# bucket) and everything in main.tf is a guardrail. These are deliberately few:
# the golden path stays opinionated, but a team is not stuck with defaults that
# do not fit its data.

variable "retention_days" {
  description = "Delete NONCURRENT object versions this many days after they are superseded. Null keeps every version indefinitely (the default). Live objects are never touched."
  type        = number
  default     = null

  validation {
    # A conditional, not `can(...)`: can() reports whether the expression EVALUATED,
    # so can(0 >= 1) is true and would wave every out-of-range value through.
    condition     = var.retention_days == null ? true : (var.retention_days >= 1 && var.retention_days <= 3650 && floor(var.retention_days) == var.retention_days)
    error_message = "retention_days must be a whole number of days between 1 and 3650, or null."
  }
}

variable "storage_class" {
  description = "Storage class for the bucket. Restricted to classes with no minimum-storage-duration billing surprise on a self-service path."
  type        = string
  default     = "STANDARD"

  validation {
    condition     = contains(["STANDARD", "NEARLINE"], var.storage_class)
    error_message = "storage_class must be one of: STANDARD, NEARLINE."
  }
}

variable "extra_labels" {
  description = "Additional labels for cost attribution or ownership context. The platform's own labels are reserved and cannot be set here."
  type        = map(string)
  default     = {}

  validation {
    condition     = length(setintersection(keys(var.extra_labels), ["owning-team", "environment", "managed-by", "request-id"])) == 0
    error_message = "extra_labels must not set the platform's own labels: owning-team, environment, managed-by, request-id."
  }

  validation {
    condition     = alltrue([for k, v in var.extra_labels : can(regex("^[a-z][a-z0-9_-]{0,62}$", k)) && can(regex("^[a-z0-9_-]{0,63}$", v))])
    error_message = "extra_labels keys must start with a letter and keys/values must be lowercase letters, digits, underscores or hyphens (GCS label charset)."
  }

  validation {
    condition     = length(var.extra_labels) <= 8
    error_message = "extra_labels is capped at 8 labels."
  }
}
