#!/usr/bin/env python3
"""Verify every `uses: ./...` in the workflows resolves to a real action.

actionlint does not check this, and a mis-indented edit can silently fold a
following line into the `uses:` scalar — still valid YAML, still lint-clean, but
the action path is now junk and the job fails at run time. That happened once;
this is the guard.
"""
import glob
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("!! PyYAML is required (pip install pyyaml)")

failures = []
for path in sorted(glob.glob(".github/workflows/*.yml")):
    doc = yaml.safe_load(open(path, encoding="utf-8")) or {}
    for job_name, job in (doc.get("jobs") or {}).items():
        for step in (job.get("steps") or []):
            uses = step.get("uses")
            if not isinstance(uses, str) or not uses.startswith("./"):
                continue
            if not any(os.path.isfile(os.path.join(uses, f))
                       for f in ("action.yml", "action.yaml")):
                failures.append(f"{path}::{job_name} -> {uses!r}")

if failures:
    print("!! local action reference does not resolve to an action.yml:")
    for f in failures:
        print(f"   {f}")
    sys.exit(1)
print("local composite actions all resolve")
