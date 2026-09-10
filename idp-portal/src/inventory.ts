import type { Response } from 'express';
import { FileInventory, GitHubInventory, InventoryUnavailableError, loadConfig, type InventorySource } from 'idp-core';

// Which inventory the platform answers from, and how a request gets hold of it.
//
// idp-core never reads GitHub config from the environment — a driver is given
// its token, owner and repo. That property is kept here: this module is the one
// place that turns environment into a configured source.

export type InventoryKind = 'file' | 'github';

/** `file` while the GitHub source is still opt-in; the default flips separately. */
export function inventoryKind(): InventoryKind {
  return process.env.IDP_INVENTORY === 'github' ? 'github' : 'file';
}

/**
 * A source that always fails, with the fix in the message.
 *
 * Selecting `github` without the credential to use it is a misconfiguration, and
 * the one thing it must not do is quietly read the working tree instead: serving
 * a stale copy while claiming to be the repo is the defect this whole port
 * exists to remove.
 */
function misconfigured(detail: string): InventorySource {
  return { list: () => Promise.reject(new InventoryUnavailableError(detail)) };
}

export function makeInventorySource(): InventorySource {
  const orgPrefix = loadConfig().orgPrefix;
  if (inventoryKind() === 'file') return new FileInventory({ orgPrefix });

  const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo) {
    return misconfigured(
      'inventory source is "github" but GITHUB_REPO is not set (expected <owner>/<repo>). Set it, or IDP_INVENTORY=file for offline work.',
    );
  }
  if (!token) {
    return misconfigured(
      'inventory source is "github" but GITHUB_TOKEN is not set. Set it, or IDP_INVENTORY=file for offline work.',
    );
  }
  return new GitHubInventory({ token, owner, repo, orgPrefix });
}

/**
 * The source for this request, built once and remembered on `res.locals`.
 *
 * One instance per request is what lets a network-backed source memoise its read
 * for the life of the request without a TTL — and a TTL is exactly how staleness
 * would creep back in. Scoping it to the response object is what makes the
 * memoisation expire when the request does, with no clock involved.
 */
export function inventoryOf(res: Response): InventorySource {
  const cached = res.locals.inventory as InventorySource | undefined;
  if (cached) return cached;
  // Built on first use, not on every request: most routes never read the
  // inventory, and constructing one re-reads platform/*.yaml off disk.
  const source = makeInventorySource();
  res.locals.inventory = source;
  return source;
}
