import { GUARDRAILS, type BucketRecord } from 'idp-core';

// Translate the GitOps record into the API's `Bucket`. Kept apart from the
// domain so the wire shape can evolve without disturbing idp-core, and so the
// contract stays the only description of what a client sees.

/**
 * The short name the developer chose. A stack dir is `<team>-<name>` and the
 * team is recorded in metadata.yaml, so the remainder is the name — which stays
 * correct even though both parts may themselves contain hyphens.
 */
export function shortName(record: BucketRecord): string {
  const dirName = record.stackDir.split('/').pop() ?? '';
  const prefix = `${record.owning_team}-`;
  return dirName.startsWith(prefix) ? dirName.slice(prefix.length) : dirName;
}

export function toBucket(record: BucketRecord) {
  return {
    bucketId: record.bucketName,
    name: shortName(record),
    environment: record.environment,
    owningTeam: record.owning_team,
    type: record.type,
    requestId: record.request_id,
    requester: record.requester,
    createdAt: record.created_at,
    stackDir: record.stackDir,
    guardrails: GUARDRAILS,
    settings: { ...record.settings },
  };
}
