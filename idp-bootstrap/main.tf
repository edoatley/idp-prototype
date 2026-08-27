# The dedicated GCP project for the prototype. No org/folder parent (personal
# account); billing is linked so real resources can be provisioned.
resource "google_project" "idp" {
  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account

  labels = {
    managed-by = "idp"
    component  = "bootstrap"
  }
}

locals {
  # APIs needed for: bucket provisioning + Workload Identity Federation + IAM.
  services = [
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = google_project.idp.project_id
  service = each.value

  # Keep APIs enabled if this config is destroyed, to avoid disruptive toggles.
  disable_on_destroy = false
}
