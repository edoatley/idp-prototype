# idp-prototype

A hands-on prototype to **experience the value and component parts of an Internal Developer
Platform (IDP)** — with a focus on how an IDP delivers oversight, visibility and metrics.

The first capability is developer self-service for creating a **GCS bucket** in GCP, end to
end: a thin custom portal → a GitOps PR → Terraform apply → a real, compliant bucket, plus a
visibility dashboard over what exists, who owns it, how the platform is performing, and
whether things stay compliant.

See **[PRD.md](./PRD.md)** for the full design and **[EVALUATION.md](./EVALUATION.md)** for
the running learnings log.

**See the platform in action:** a step-by-step, screenshot-rich tour lives in
**[docs/walkthrough/](./docs/walkthrough/README.md)** — foundations → module → portal → policy
gate → apply → dashboard → day-2.

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

## Tooling

The prototype is deliberately built from small, standard, portable tools. If you're new to
any of them, here's what each does and where it's used:

| Tool | Role in this repo | Docs |
|---|---|---|
| **Terraform** | Infrastructure as code. The `gcs-bucket` module encodes the guardrails; per-request *stacks* call it with a GCS backend for state. | [terraform.io](https://developer.hashicorp.com/terraform) |
| **`terraform test` + `mock_provider`** | Credential-free unit tests that assert the module's guardrails (UBLA, public-access prevention, versioning, labels, naming) — no cloud, no keys. | [tests](https://developer.hashicorp.com/terraform/language/tests) · [mock_provider](https://developer.hashicorp.com/terraform/language/tests/mocking) |
| **TFLint** | Static linting of Terraform (config in `.tflint.hcl`). | [tflint](https://github.com/terraform-linters/tflint) |
| **Trivy** | Security/misconfiguration scanning of the Terraform (`trivy config`). Accepted, documented exceptions live in [`.trivyignore`](./.trivyignore). | [trivy.dev](https://trivy.dev/) |
| **Conftest + Open Policy Agent (Rego)** | The **policy-as-code gate** (`idp-gitops/policy/`). Rego rules evaluate `terraform show -json` and *deny* any bucket that breaks a guardrail — an independent second layer that catches even Terraform which bypasses the module. | [conftest.dev](https://www.conftest.dev/) · [OPA](https://www.openpolicyagent.org/docs/) · [Rego](https://www.openpolicyagent.org/docs/latest/policy-language/) |
| **GitHub Actions** | CI/CD: `terraform-checks` (credential-free static + unit + policy tests), `pr` (`plan` + policy gate + PR comment), `apply` (on merge). | [docs](https://docs.github.com/actions) |
| **Workload Identity Federation** (`google-github-actions/auth`) | **Keyless** GCP auth from Actions — no service-account keys, ever. Set up in `idp-bootstrap`; used by `pr`/`apply`. | [auth action](https://github.com/google-github-actions/auth) · [GCP WIF](https://cloud.google.com/iam/docs/workload-identity-federation) |

**Two-layer compliance, on purpose:** the module *prevents* misconfiguration by construction
(and is proven by `terraform test`); the Conftest gate *detects* it in the plan (and is proven
by `conftest verify`). They are independent so a gap in one is caught by the other.

**Run every check locally** (mirrors CI, credential-free) with [`scripts/checks.sh`](./scripts/checks.sh) —
it needs `terraform`, `tflint`, `trivy` and `conftest` on your PATH.

## Status
Phases 0-5 are **complete**: GCP + CI foundations, the Terraform golden path, the
policy-as-code gate, the thin portal, day-2 (drift + decommission), and the visibility
dashboard. Phase 6 — the guided walkthrough — is in progress in
[`docs/walkthrough/`](./docs/walkthrough/README.md). Backstage is deferred/optional.

See [EVALUATION.md](./EVALUATION.md) for per-phase learnings, [CLAUDE.md](./CLAUDE.md) for the
phase plan, and [docs/portal-to-terraform.md](./docs/portal-to-terraform.md) for how a portal
request becomes Terraform.
