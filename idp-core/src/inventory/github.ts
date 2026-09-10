import { makeGh, GitHubError } from '../github';
import { byStackDir, toRecord } from './record';
import { InventoryUnavailableError, STACKS_PREFIX, type BucketRecord, type InventorySource } from './source';

// The inventory as the repo actually is: read from the base branch, live.
//
// The defect this replaces was a local checkout answering confidently while two
// commits behind main, so the platform denied a bucket it had just provisioned.
// Nothing here may reintroduce that: every failure raises, and the only cache is
// keyed by content.

const METADATA = new RegExp(`^${STACKS_PREFIX}/([^/]+)/([^/]+)/metadata\\.yaml$`);

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
  truncated?: boolean;
}

interface BlobResponse {
  content?: string;
  encoding?: string;
}

/**
 * Blob text by git SHA — process-wide, and safe to be.
 *
 * A git blob SHA is the hash of its content, so a cached SHA cannot be the wrong
 * bytes: this cache cannot go stale, by construction. That is why the tree call
 * is NOT cached and carries no TTL. A time-based cache would reintroduce exactly
 * the staleness bug with a smaller window, trading unconditional correctness for
 * probabilistic correctness to save one API call.
 */
const blobs = new Map<string, string>();

// Every edit of a metadata.yaml mints a new SHA, so the map only ever grows.
// Nothing in it is precious — dropping an entry costs one refetch.
const MAX_BLOBS = 500;

/** Simultaneous blob fetches. Enough to be quick, few enough not to look abusive. */
const CONCURRENCY = 8;

/** Test seam — the cache is process-wide and would otherwise leak between cases. */
export function clearInventoryCache(): void {
  blobs.clear();
}

export interface GitHubInventoryOptions {
  token: string;
  owner: string;
  repo: string;
  baseBranch?: string;
  orgPrefix?: string;
  fetchImpl?: typeof fetch;
}

export class GitHubInventory implements InventorySource {
  private readonly gh: ReturnType<typeof makeGh>;
  private readonly base: string;
  private readonly orgPrefix: string;
  private pending?: Promise<BucketRecord[]>;

  constructor(opts: GitHubInventoryOptions) {
    this.gh = makeGh({
      token: opts.token,
      owner: opts.owner,
      repo: opts.repo,
      fetchImpl: opts.fetchImpl ?? fetch,
    });
    this.base = opts.baseBranch ?? 'main';
    this.orgPrefix = opts.orgPrefix ?? 'edo';
  }

  /**
   * Memoised for the life of this instance, which is one HTTP request — the
   * create path reads the inventory twice. Instance-scoped rather than global
   * precisely so it expires when the request does, with no clock involved.
   */
  list(): Promise<BucketRecord[]> {
    this.pending ??= this.read().catch((e) => {
      // A failed read must not be remembered as the answer to the next one.
      this.pending = undefined;
      throw e;
    });
    return this.pending;
  }

  private async read(): Promise<BucketRecord[]> {
    const tree = await this.call<TreeResponse>(`/git/trees/${this.base}?recursive=1`);

    // A truncated tree is a PARTIAL inventory that looks complete — the same
    // failure mode as a stale one, and the reason this raises instead of
    // returning what it got.
    if (tree.truncated) {
      throw new InventoryUnavailableError(
        `the git tree for ${this.base} was truncated, so the inventory would be incomplete. The repository has outgrown a single tree read.`,
      );
    }

    // `truncated` being absent is not the same as it being false. A 200 whose
    // body is not a tree at all — an empty body, a proxy's interstitial, a
    // change in the API's shape — would otherwise filter down to zero stacks and
    // be served as "the platform contains nothing": the original defect exactly,
    // wearing a different hat.
    if (!Array.isArray(tree.tree)) {
      throw new InventoryUnavailableError(
        `GitHub returned no git tree for ${this.base}, so the inventory could not be read. The response did not have the expected shape.`,
      );
    }

    const stacks = tree.tree.filter((e) => e.type === 'blob' && METADATA.test(e.path));
    const records = await this.fetchAll(stacks);
    return records.sort(byStackDir);
  }

  /**
   * The records, a bounded number of blob fetches at a time.
   *
   * Unbounded would mean one simultaneous request per stack on a cold cache,
   * which is the shape GitHub's secondary rate limits are written to catch — and
   * tripping one fails the whole read rather than slowing it down.
   */
  private async fetchAll(stacks: TreeEntry[]): Promise<BucketRecord[]> {
    const records: BucketRecord[] = [];
    const queue = [...stacks];

    const worker = async () => {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        const [, env, dirName] = METADATA.exec(entry.path)!;
        records.push(this.record(entry.path, env!, dirName!, await this.blob(entry.sha)));
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return records;
  }

  /**
   * A record, or a failure that says which file is wrong.
   *
   * A metadata.yaml that will not parse is an unreadable inventory, not an
   * internal error — and certainly not a record to skip, which would serve a
   * partial inventory that looks complete. One bad file on the base branch stops
   * every read until it is fixed, loudly and by name.
   */
  private record(path: string, env: string, dirName: string, text: string): BucketRecord {
    try {
      return toRecord(env, dirName, text, this.orgPrefix);
    } catch (e) {
      throw new InventoryUnavailableError(`${path} on ${this.base} could not be read: ${(e as Error).message}`);
    }
  }

  private async blob(sha: string): Promise<string> {
    const cached = blobs.get(sha);
    if (cached !== undefined) return cached;

    // The full 40-character SHA is required here; a shortened one 404s.
    const blob = await this.call<BlobResponse>(`/git/blobs/${sha}`);
    if (blob.encoding !== 'base64' || blob.content === undefined) {
      throw new InventoryUnavailableError(`GitHub returned blob ${sha} as "${blob.encoding ?? 'nothing'}", which cannot be read.`);
    }

    const text = Buffer.from(blob.content, 'base64').toString('utf8');
    // Oldest out, one at a time. Clearing the whole map instead would thrash it
    // inside a single read once the repo is bigger than the cap, so every later
    // request would refetch everything.
    while (blobs.size >= MAX_BLOBS) blobs.delete(blobs.keys().next().value!);
    blobs.set(sha, text);
    return text;
  }

  /**
   * Upstream failures become InventoryUnavailableError, never a GitHubError.
   *
   * The inventory is read with the PLATFORM's credential, so a 401 here means
   * the platform's token is wrong — not the caller's. Letting a GitHubError
   * through would report that to whoever happened to be asking, sending them to
   * check a credential that is working fine.
   */
  private async call<T>(path: string): Promise<T> {
    try {
      const { data } = await this.gh<T>('GET', path);
      return data;
    } catch (e) {
      if (e instanceof GitHubError) {
        throw new InventoryUnavailableError(`could not read the inventory from GitHub: ${e.message}`);
      }
      throw new InventoryUnavailableError(`could not read the inventory from GitHub: ${(e as Error).message}`);
    }
  }
}
