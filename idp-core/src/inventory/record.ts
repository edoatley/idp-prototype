import yaml from 'js-yaml';
import { DEFAULT_SETTINGS, type BucketSettings } from '../guardrails';
import { bucketNameFromDir } from '../naming';
import { STACKS_PREFIX, type BucketRecord } from './source';

// Parsing a metadata.yaml into an inventory record, in one place.
//
// Every source goes through this, so a record read from the base branch and one
// read from a local checkout cannot describe the same stack differently — which
// would make the two sources hard to compare and the switch between them risky.

interface RawMetadata {
  type?: string;
  owning_team?: string;
  environment?: string;
  request_id?: string;
  requester?: string;
  created_at?: string | number;
  updated_at?: string | number;
  updated_by?: string;
  settings?: {
    retention_days?: number | null;
    storage_class?: string;
    extra_labels?: Record<string, string> | null;
  };
}

/**
 * One stack's record. `dirName` is the stack directory (already `<team>-<name>`).
 *
 * `stackDir` is built from the repo-relative convention rather than from wherever
 * the caller happened to read the file, so a fixture directory and the real repo
 * produce the same identifier.
 */
export function toRecord(env: string, dirName: string, text: string, orgPrefix: string): BucketRecord {
  const m = (yaml.load(text) ?? {}) as RawMetadata;
  return {
    stackDir: `${STACKS_PREFIX}/${env}/${dirName}`,
    bucketName: bucketNameFromDir(orgPrefix, env, dirName),
    type: m.type ?? 'gcs-bucket',
    owning_team: m.owning_team ?? '',
    environment: m.environment ?? env,
    request_id: m.request_id ?? '',
    requester: m.requester ?? '',
    // Unquoted YAML dates parse as Date, not string — coerce so the record shape
    // does not depend on how someone wrote the file.
    created_at: String(m.created_at ?? ''),
    updated_at: String(m.updated_at ?? ''),
    updated_by: m.updated_by ?? '',
    settings: readSettings(m.settings),
  };
}

/** Stable order, so two sources are diffable and the UI does not reshuffle. */
export function byStackDir(a: BucketRecord, b: BucketRecord): number {
  return a.stackDir.localeCompare(b.stackDir);
}

/**
 * Settings recorded on a stack, falling back to the platform defaults.
 *
 * Stacks created before settings existed simply have no `settings:` block — they
 * are running on the defaults, which is exactly what this returns. No migration
 * needed, and an old record and a new one describe the same bucket the same way.
 */
function readSettings(s: RawMetadata['settings']): BucketSettings {
  if (!s) return { ...DEFAULT_SETTINGS };
  const storageClass = s.storage_class === 'NEARLINE' ? 'NEARLINE' : DEFAULT_SETTINGS.storageClass;
  return {
    retentionDays: typeof s.retention_days === 'number' ? s.retention_days : null,
    storageClass,
    extraLabels: s.extra_labels ?? {},
  };
}
