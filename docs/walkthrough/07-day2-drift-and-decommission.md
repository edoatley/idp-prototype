# 7 — Day-2: drift detection & decommission

*(Phase 4 — `.github/workflows/drift.yml` + `destroy.yml` + portal decommission)*

Day-2 operations, all as GitOps: drift is surfaced as a self-closing Issue, and teardown is a
one-click PR.

## Drift detection

### Do this

```bash
# introduce out-of-band drift on the live bucket (safely reversible):
gcloud storage buckets update gs://edo-dev-platform-demo --no-versioning
gh workflow run drift.yml          # or wait for the daily schedule
```

Watch the run, then open the **`Drift: …platform-demo`** Issue it creates. Revert and re-run to
watch it auto-close:

```bash
gcloud storage buckets update gs://edo-dev-platform-demo --versioning
gh workflow run drift.yml
```

### What's happening & why

`drift.yml` plans **every** stack on a schedule; a non-empty plan (`-detailed-exitcode` = 2) means
someone changed a resource outside Terraform. Drift opens/updates a per-stack GitHub Issue with the
plan and closes it when the stack is back in sync — turning drift into something actionable that
also feeds the compliance panel.

![The Drift: Issue opened by drift.yml, with the plan](images/07-drift-issue.png)

## Decommission

### Do this

In the portal, open `http://localhost:3000/buckets`, click **Decommission** on a bucket → it opens
a removal PR. Merge it and watch `destroy.yml`:

```bash
gh run watch $(gh run list --workflow=destroy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gcloud storage buckets describe gs://edo-dev-<team>-<name>   # expect: 404 not found
```

### What's happening & why

Delete = **remove the stack dir** (the portal opens a PR that deletes the files via the GitHub
git-data API). On merge, `destroy.yml` detects the *removed* stack — disjoint from `apply.yml`,
which handles added/modified — restores the config from the parent commit (Terraform needs it to
destroy), runs `terraform destroy` via WIF, and posts a **`♻️ Decommissioned`** comment.
`force_destroy = false` means a non-empty bucket fails loudly rather than losing data.

![The portal decommission → removal PR (file deletions)](images/07-decommission-pr.png)

![destroy.yml run + the ♻️ Decommissioned comment; bucket now 404](images/07-destroy-run.png)

## Reference links

- Workflows: [`drift.yml`](../../.github/workflows/drift.yml), [`destroy.yml`](../../.github/workflows/destroy.yml)
- Real artifacts: [Issue #28 (Drift)](https://github.com/edoatley/idp-prototype/issues/28),
  [PR #30 (decommission checkout-orders)](https://github.com/edoatley/idp-prototype/pull/30)
- PRs: [#25 drift](https://github.com/edoatley/idp-prototype/pull/25),
  [#29 drift fix](https://github.com/edoatley/idp-prototype/pull/29),
  [#26 destroy](https://github.com/edoatley/idp-prototype/pull/26),
  [#27 portal decommission](https://github.com/edoatley/idp-prototype/pull/27)

---
That's the tour — back to the [index](README.md).
