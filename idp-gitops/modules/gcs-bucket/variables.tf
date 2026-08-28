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
