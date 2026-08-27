# Remote Terraform state bucket used by idp-gitops (one state prefix per request).
# Name is derived from the globally-unique project_id, so the bucket name is unique too.
resource "google_storage_bucket" "tfstate" {
  project  = google_project.idp.project_id
  name     = "${var.project_id}-tfstate"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Protect state: block accidental `terraform destroy` from deleting the bucket
  # while it still holds objects.
  force_destroy = false

  versioning {
    enabled = true
  }

  labels = {
    managed-by = "idp"
    component  = "tfstate"
  }

  depends_on = [google_project_service.enabled]
}
