variable "project_id" {
  description = "Globally-unique GCP project ID to create for the IDP prototype."
  type        = string
  default     = "idp-prototype-edo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be 6-30 chars, lowercase letters/digits/hyphens, starting with a letter."
  }
}

variable "project_name" {
  description = "Human-readable project name."
  type        = string
  default     = "EDO IDP Prototype"
}

variable "billing_account" {
  description = "Billing account ID to link (e.g. 010F10-A51056-E8EC40)."
  type        = string
}

variable "region" {
  description = "Default GCP region for prototype resources (London)."
  type        = string
  default     = "europe-west2"
}

variable "github_repo" {
  description = "owner/repo allowed to authenticate via Workload Identity Federation."
  type        = string
  default     = "edoatley/idp-prototype"

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repo))
    error_message = "github_repo must be in 'owner/repo' form."
  }
}
