# DEMO ONLY — deliberately non-compliant stack to prove the Phase 2 policy gate.
# It bypasses the gcs-bucket module and calls the raw resource with public access,
# no UBLA, no versioning, wrong region, no mandatory labels, and a bad name prefix.
# The pr.yml conftest gate MUST block this. This PR is never merged.

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "idp-prototype-edo-tfstate"
    prefix = "stacks/dev/platform-bad"
  }
}

provider "google" {
  project = "idp-prototype-edo"
  region  = "europe-west2"
}

resource "google_storage_bucket" "raw" {
  project                     = "idp-prototype-edo"
  name                        = "public-demo-bad-bucket-edoatley"
  location                    = "US"
  uniform_bucket_level_access = false
  public_access_prevention    = "inherited"
  force_destroy               = true
}
