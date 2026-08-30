package main

import rego.v1

# Credential-free unit tests for the policy gate. Run with `conftest verify`.
# Fixtures are inlined in the plan-JSON shape (resource_changes[].change.after)
# so the tests are self-contained; testdata/*.json mirror these for the manual
# `conftest test <file>` demonstration.

# A fully compliant bucket (matches the Phase 1 platform-demo plan).
compliant_plan := {"resource_changes": [{
	"address": "module.bucket.google_storage_bucket.this",
	"type": "google_storage_bucket",
	"change": {"actions": ["create"], "after": {
		"name": "edo-dev-platform-demo",
		"location": "EUROPE-WEST2",
		"uniform_bucket_level_access": true,
		"public_access_prevention": "enforced",
		"versioning": [{"enabled": true}],
		"labels": {
			"owning-team": "platform",
			"environment": "dev",
			"managed-by": "idp",
			"request-id": "req-20260829-platform-demo",
		},
	}},
}]}

# Helper: build a plan from a single bucket "after" object.
plan_with(after) := {"resource_changes": [{
	"type": "google_storage_bucket",
	"change": {"actions": ["create"], "after": after},
}]}

compliant_after := compliant_plan.resource_changes[0].change.after

test_compliant_has_no_denies if {
	count(deny) == 0 with input as compliant_plan
}

test_public_access_denied if {
	after := object.union(compliant_after, {"public_access_prevention": "inherited"})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "public_access_prevention")
}

test_no_ubla_denied if {
	after := object.union(compliant_after, {"uniform_bucket_level_access": false})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "uniform_bucket_level_access")
}

test_no_versioning_denied if {
	after := object.union(compliant_after, {"versioning": [{"enabled": false}]})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "versioning")
}

test_wrong_region_denied if {
	after := object.union(compliant_after, {"location": "US"})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "location")
}

# object.union deep-merges, so to actually DROP a label we remove the key first.
test_missing_label_denied if {
	base := object.remove(compliant_after, {"labels"})
	after := object.union(base, {"labels": {"environment": "dev", "managed-by": "idp", "request-id": "r"}})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "owning-team")
}

test_wrong_managed_by_denied if {
	after := object.union(compliant_after, {"labels": {
		"owning-team": "platform", "environment": "dev",
		"managed-by": "someone-else", "request-id": "r",
	}})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "managed-by")
}

test_bad_name_prefix_denied if {
	after := object.union(compliant_after, {"name": "public-bucket"})
	msgs := deny with input as plan_with(after)
	some m in msgs
	contains(m, "edo-")
}

# The raw-resource bypass (a public bucket that skips the module) fails on
# multiple counts.
test_public_bypass_has_many_denies if {
	after := {
		"name": "public-bucket",
		"location": "US",
		"uniform_bucket_level_access": false,
		"public_access_prevention": "inherited",
		"versioning": [{"enabled": false}],
		"labels": {},
	}
	count(deny) > 3 with input as plan_with(after)
}

# Deletes (after == null) must not error or deny.
test_delete_is_ignored if {
	plan := {"resource_changes": [{
		"type": "google_storage_bucket",
		"change": {"actions": ["delete"], "after": null},
	}]}
	count(deny) == 0 with input as plan
}
