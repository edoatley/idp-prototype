import type { BucketSettings } from '../guardrails';

// The read side of the platform: what the GitOps repo declares exists.
//
// This is a port, in the same shape as ChangeDriver, for the same reason: the
// question "what does the platform contain?" has more than one honest answer
// depending on where you ask it from (a local checkout, the base branch), and
// the surfaces above must not know which one they got.

/** Where every stack lives, relative to the repo root. */
export const STACKS_PREFIX = 'idp-gitops/stacks';

export interface BucketRecord {
  stackDir: string; // repo-relative, e.g. idp-gitops/stacks/dev/checkout-orders
  bucketName: string; // edo-<env>-<team>-<name>
  type: string;
  owning_team: string;
  environment: string;
  request_id: string;
  requester: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  settings: BucketSettings;
}

export interface InventorySource {
  list(): Promise<BucketRecord[]>;
}

/**
 * The inventory could not be read — so nothing is returned.
 *
 * Deliberately not a fallback: the defect this port exists to fix was a stale
 * copy of the repo answering confidently. An empty or out-of-date list that
 * *looks* authoritative is the failure mode; an error is not.
 */
export class InventoryUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'InventoryUnavailableError';
  }
}
