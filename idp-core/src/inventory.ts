import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_SETTINGS, type BucketSettings } from './guardrails';

// Reads the inventory straight from the GitOps source of truth: every stack's
// metadata.yaml. No database — the repo IS the inventory (as in the PRD). This is
// the read side the decommission UI (and, later, the Phase 5 dashboard) build on.

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

export function defaultStacksDir(): string {
  return process.env.STACKS_DIR ?? path.resolve(__dirname, '../../idp-gitops/stacks');
}

export function listBuckets(root: string = defaultStacksDir()): BucketRecord[] {
  if (!fs.existsSync(root)) return [];
  const records: BucketRecord[] = [];
  for (const env of fs.readdirSync(root)) {
    const envDir = path.join(root, env);
    if (!fs.statSync(envDir).isDirectory()) continue;
    for (const name of fs.readdirSync(envDir)) {
      const metaPath = path.join(envDir, name, 'metadata.yaml');
      if (!fs.existsSync(metaPath)) continue;
      const m = yaml.load(fs.readFileSync(metaPath, 'utf8')) as {
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
      };
      records.push({
        stackDir: `idp-gitops/stacks/${env}/${name}`,
        bucketName: `edo-${env}-${name}`, // dir name is already <team>-<name>
        type: m.type ?? 'gcs-bucket',
        owning_team: m.owning_team ?? '',
        environment: m.environment ?? env,
        request_id: m.request_id ?? '',
        requester: m.requester ?? '',
        created_at: String(m.created_at ?? ''),
        updated_at: String(m.updated_at ?? ''),
        updated_by: m.updated_by ?? '',
        settings: readSettings(m.settings),
      });
    }
  }
  return records.sort((a, b) => a.stackDir.localeCompare(b.stackDir));
}

/**
 * Settings recorded on a stack, falling back to the platform defaults.
 *
 * Stacks created before settings existed simply have no `settings:` block — they
 * are running on the defaults, which is exactly what this returns. No migration
 * needed, and an old record and a new one describe the same bucket the same way.
 */
function readSettings(
  s: { retention_days?: number | null; storage_class?: string; extra_labels?: Record<string, string> | null } | undefined,
): BucketSettings {
  if (!s) return { ...DEFAULT_SETTINGS };
  const storageClass = s.storage_class === 'NEARLINE' ? 'NEARLINE' : DEFAULT_SETTINGS.storageClass;
  return {
    retentionDays: typeof s.retention_days === 'number' ? s.retention_days : null,
    storageClass,
    extraLabels: s.extra_labels ?? {},
  };
}
