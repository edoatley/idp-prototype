import fs from 'node:fs';
import path from 'node:path';
import { byStackDir, toRecord } from './record';
import type { BucketRecord, InventorySource } from './source';

// The inventory as a local checkout sees it: walk stacks/*/*/metadata.yaml on
// disk. Correct only insofar as the checkout is current, which is why it is no
// longer the default — see docs/design/inventory-source.md. Kept for offline
// work and for the test suites, which must not reach the network.

export function defaultStacksDir(): string {
  return process.env.STACKS_DIR ?? path.resolve(__dirname, '../../../idp-gitops/stacks');
}

export function listBuckets(root: string = defaultStacksDir(), orgPrefix = 'edo'): BucketRecord[] {
  if (!fs.existsSync(root)) return [];
  const records: BucketRecord[] = [];
  for (const env of fs.readdirSync(root)) {
    const envDir = path.join(root, env);
    if (!fs.statSync(envDir).isDirectory()) continue;
    for (const name of fs.readdirSync(envDir)) {
      const metaPath = path.join(envDir, name, 'metadata.yaml');
      if (!fs.existsSync(metaPath)) continue;
      records.push(toRecord(env, name, fs.readFileSync(metaPath, 'utf8'), orgPrefix));
    }
  }
  return records.sort(byStackDir);
}

export interface FileInventoryOptions {
  root?: string;
  orgPrefix?: string;
}

export class FileInventory implements InventorySource {
  constructor(private readonly opts: FileInventoryOptions = {}) {}

  async list(): Promise<BucketRecord[]> {
    return listBuckets(this.opts.root ?? defaultStacksDir(), this.opts.orgPrefix ?? 'edo');
  }
}
