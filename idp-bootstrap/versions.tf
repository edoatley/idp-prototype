terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Deliberately NO remote backend here: bootstrap CREATES the state bucket that
  # every other repo/stack will use, so it must run with LOCAL state first.
  # The resulting terraform.tfstate is gitignored — keep it (or import) to manage
  # these foundations later.
}

provider "google" {
  region = var.region
  # Project is set explicitly on each resource (the project doesn't exist until
  # this apply runs), so we don't set a provider-level project.
}
