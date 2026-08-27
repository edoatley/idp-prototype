# idp-prototype

A hands-on prototype to **experience the value and component parts of an Internal Developer
Platform (IDP)** — with a focus on how an IDP delivers oversight, visibility and metrics.

The first capability is developer self-service for creating a **GCS bucket** in GCP, end to
end: a thin custom portal → a GitOps PR → Terraform apply → a real, compliant bucket, plus a
visibility dashboard over what exists, who owns it, how the platform is performing, and
whether things stay compliant.

See **[PRD.md](./PRD.md)** for the full design and **[EVALUATION.md](./EVALUATION.md)** for
the running learnings log.

## Approach at a glance
- **Thin custom portal** first (disposable); **Backstage** evaluated/migrated in a later phase.
- **Terraform + GitHub-based GitOps** backend — deliberately **portal-agnostic** (the durable investment).
- **GitOps, PR-based** flow: `plan` on PR, `apply` on merge.
- **Minimal, opinionated golden path**: dev supplies `name` + `owning_team` + `environment`;
  the platform enforces region, labels, versioning, uniform access, and public-access prevention.
- **Visibility layer**: resource inventory + ownership, delivery metrics, compliance/drift status.

## Planned repo layout
```
idp-bootstrap/   # one-time: GCP project, billing, state bucket, WIF, CI service account
idp-gitops/      # portal-agnostic source of truth: TF modules, per-request stacks, policies, workflows
idp-portal/      # thin custom app: create-bucket form (write) + visibility dashboard (read)
```

## Status
Design complete; implementation not started. Phase 0 (`idp-bootstrap`) is the entry point and
needs three conventions decided first: **GCP region**, **org prefix**, and the **initial team list**.
