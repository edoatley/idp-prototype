output "bucket_name" {
  description = "The deterministic name of the provisioned bucket."
  value       = google_storage_bucket.this.name
}

output "bucket_url" {
  description = "The gs:// URL of the bucket."
  value       = google_storage_bucket.this.url
}

output "bucket_self_link" {
  description = "The URI of the bucket resource."
  value       = google_storage_bucket.this.self_link
}

output "labels" {
  description = "The mandatory labels applied to the bucket (inventory/ownership record)."
  value       = google_storage_bucket.this.labels
}
