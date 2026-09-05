package main

import rego.v1

# Independent compliance gate over `terraform show -json` output.
#
# These rules mirror the guardrails baked into modules/gcs-bucket, but they run
# against the plan for EVERY google_storage_bucket — so a stack that calls the
# raw resource and bypasses the module is still caught. The module *prevents*;
# this gate *detects*. Any deny fails the PR (conftest exits non-zero).

# The post-apply state of each bucket in the plan (skips deletes: after == null).
buckets contains after if {
	some rc in input.resource_changes
	rc.type == "google_storage_bucket"
	after := rc.change.after
	after != null
}

# Best-effort name for messages, even on partial/computed plans.
bucket_name(b) := name if {
	name := object.get(b, "name", "<unknown>")
}

# --- Public access ---------------------------------------------------------
deny contains msg if {
	some b in buckets
	object.get(b, "public_access_prevention", "unset") != "enforced"
	msg := sprintf("bucket %q: public_access_prevention must be \"enforced\" (got %v)", [bucket_name(b), object.get(b, "public_access_prevention", "unset")])
}

# --- Uniform bucket-level access -------------------------------------------
deny contains msg if {
	some b in buckets
	object.get(b, "uniform_bucket_level_access", false) != true
	msg := sprintf("bucket %q: uniform_bucket_level_access must be true", [bucket_name(b)])
}

# --- Versioning ------------------------------------------------------------
versioning_enabled(b) if {
	some v in object.get(b, "versioning", [])
	v.enabled == true
}

deny contains msg if {
	some b in buckets
	not versioning_enabled(b)
	msg := sprintf("bucket %q: versioning must be enabled", [bucket_name(b)])
}

# --- Region ----------------------------------------------------------------
deny contains msg if {
	some b in buckets
	lower(object.get(b, "location", "")) != "europe-west2"
	msg := sprintf("bucket %q: location must be europe-west2 (got %v)", [bucket_name(b), object.get(b, "location", "unset")])
}

# --- Mandatory labels ------------------------------------------------------
required_labels := {"owning-team", "environment", "managed-by", "request-id"}

deny contains msg if {
	some b in buckets
	some key in required_labels
	not has_label(b, key)
	msg := sprintf("bucket %q: missing mandatory label %q", [bucket_name(b), key])
}

has_label(b, key) if {
	val := object.get(b, "labels", {})[key]
	val != ""
	val != null
}

deny contains msg if {
	some b in buckets
	object.get(b, "labels", {})["managed-by"] != "idp"
	object.get(b, "labels", {})["managed-by"] != null # absence is reported by the missing-label rule
	msg := sprintf("bucket %q: label managed-by must be \"idp\"", [bucket_name(b)])
}

# --- Deterministic name prefix ---------------------------------------------
deny contains msg if {
	some b in buckets
	not startswith(object.get(b, "name", ""), "edo-")
	msg := sprintf("bucket %q: name must start with \"edo-\"", [bucket_name(b)])
}

# --- Storage class ---------------------------------------------------------
# Mirrors the module's allowlist. A bucket that bypasses the module cannot pick
# a class with a minimum-storage-duration billing surprise.
allowed_storage_classes := {"STANDARD", "NEARLINE"}

deny contains msg if {
	some b in buckets
	class := object.get(b, "storage_class", "STANDARD")
	class != null
	not class in allowed_storage_classes
	msg := sprintf("bucket %q: storage_class must be one of %v (got %v)", [bucket_name(b), allowed_storage_classes, class])
}

# --- Lifecycle deletion safety ---------------------------------------------
# The platform may expire NONCURRENT versions, never live objects. A Delete rule
# that is not scoped to ARCHIVED would silently destroy data a team can still
# see — the one change to a bucket that cannot be undone, so it is checked here
# independently of the module as well as in it.
deny contains msg if {
	some b in buckets
	some rule in object.get(b, "lifecycle_rule", [])
	some action in object.get(rule, "action", [])
	action.type == "Delete"
	not deletes_only_noncurrent(rule)
	msg := sprintf("bucket %q: a Delete lifecycle rule must be scoped to noncurrent versions (with_state = \"ARCHIVED\")", [bucket_name(b)])
}

deletes_only_noncurrent(rule) if {
	some cond in object.get(rule, "condition", [])
	cond.with_state == "ARCHIVED"
}
