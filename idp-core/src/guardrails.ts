// The invariants the platform enforces on every bucket and no caller can override.
//
// These mirror `idp-gitops/modules/gcs-bucket/main.tf` — where they are actually
// enforced — and are re-checked independently by the policy gate. They live here
// so a surface can *show* a team the posture it inherited without anyone reading
// Terraform. This is a description of enforcement, never the enforcement itself:
// if the module changes, this must change with it (the module's `terraform test`
// suite is the thing that would catch a real divergence).

export interface Guardrails {
  location: string;
  uniformBucketLevelAccess: true;
  publicAccessPrevention: 'enforced';
  versioning: true;
  forceDestroy: false;
}

export const GUARDRAILS: Guardrails = {
  location: 'europe-west2',
  uniformBucketLevelAccess: true,
  publicAccessPrevention: 'enforced',
  versioning: true,
  forceDestroy: false,
};

/** Settings a team may turn, with the values the module applies when they don't. */
export interface BucketSettings {
  retentionDays: number | null;
  storageClass: 'STANDARD' | 'NEARLINE';
  extraLabels: Record<string, string>;
}

export const DEFAULT_SETTINGS: BucketSettings = {
  retentionDays: null,
  storageClass: 'STANDARD',
  extraLabels: {},
};

/** Labels the platform owns; a caller may not set or shadow these. */
export const RESERVED_LABELS = ['owning-team', 'environment', 'managed-by', 'request-id'] as const;
