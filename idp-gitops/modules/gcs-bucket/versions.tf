terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # No backend and no provider "google" block here: this is a reusable module.
  # Backend + provider configuration are supplied by the calling stack
  # (idp-gitops/stacks/<env>/<team>-<name>).
}
