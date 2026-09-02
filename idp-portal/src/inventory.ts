import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

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
      });
    }
  }
  return records.sort((a, b) => a.stackDir.localeCompare(b.stackDir));
}
