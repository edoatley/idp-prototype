import { Command, Option } from 'commander';
import {
  Client,
  ApiError,
  WAIT_STOP,
  UNSUCCESSFUL,
  type Bucket,
  type PlatformRequest,
  type DryRunResult,
  type RequestStatus,
} from './client';
import { render, table, keyValue, dash, pct, statusLabel, type Format } from './output';

// The IDP command line: the same golden path as the portal, for people who live
// in a terminal and for pipelines that have no one to click a form.
//
// It is a pure client of the platform API — it holds no knowledge of Terraform,
// GitOps or GitHub. Everything it can do, the API can do, which is what keeps
// the portal, the API and this in agreement.

interface GlobalOpts {
  apiUrl: string;
  token?: string;
  output: Format;
}

function clientFor(opts: GlobalOpts): Client {
  return new Client({ baseUrl: opts.apiUrl.replace(/\/$/, ''), token: opts.token });
}

function isDryRun(result: PlatformRequest | DryRunResult): result is DryRunResult {
  return 'files' in result;
}

function renderDryRun(result: DryRunResult, format: Format): string {
  return render(format, result, () =>
    [
      `Dry run — nothing was opened.`,
      ``,
      result.summary,
      ``,
      ...result.files.flatMap((f) =>
        f.content === null
          ? [`--- ${f.path} (removed) ---`]
          : [`--- ${f.path} ---`, f.content.trimEnd(), ``],
      ),
    ].join('\n'),
  );
}

function renderRequest(req: PlatformRequest, format: Format): string {
  return render(format, req, () =>
    keyValue([
      ['request', req.requestId],
      ['intent', req.intent],
      ['status', statusLabel(req.status)],
      ['bucket', req.bucketId],
      ['stack', req.stackDir],
      ['review', req.review.url],
      ...(req.message ? ([['note', req.message]] as Array<[string, string]>) : []),
    ]),
  );
}

/**
 * How often --wait re-checks. Overridable so tests (and an impatient human) do
 * not sit through the default; the platform's own pace is minutes, not seconds.
 */
const pollIntervalMs = (): number => Number(process.env.IDP_POLL_INTERVAL_MS ?? 10_000);

/** Poll until the request reaches a state that will not change again. */
async function waitFor(
  client: Client,
  requestId: string,
  onTick: (status: RequestStatus) => void,
  intervalMs = pollIntervalMs(),
): Promise<PlatformRequest> {
  let last: RequestStatus | null = null;
  for (;;) {
    const req = await client.getRequest(requestId);
    if (req.status !== last) {
      last = req.status;
      onTick(req.status);
    }
    if (WAIT_STOP.includes(req.status)) return req;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function parseLabels(values: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const v of values) {
    const eq = v.indexOf('=');
    if (eq < 1) throw new Error(`--label expects key=value, got "${v}"`);
    labels[v.slice(0, eq)] = v.slice(eq + 1);
  }
  return labels;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('idp')
    .description('Self-service platform provisioning from the command line.')
    .version('0.1.0')
    .option('--api-url <url>', 'platform API base URL', process.env.IDP_API_URL ?? 'http://localhost:3000')
    .option('--token <token>', 'GitHub token (defaults to $IDP_TOKEN, then $GITHUB_TOKEN)')
    .addOption(new Option('-o, --output <format>', 'output format').choices(['table', 'json', 'yaml']).default('table'));

  const globals = (cmd: Command): GlobalOpts => {
    const o = cmd.optsWithGlobals();
    return {
      apiUrl: o.apiUrl,
      token: o.token ?? process.env.IDP_TOKEN ?? process.env.GITHUB_TOKEN,
      output: o.output as Format,
    };
  };

  const bucket = program.command('bucket').description('Manage buckets.');

  bucket
    .command('list')
    .description('List the buckets the platform manages.')
    .option('--environment <env>', 'filter by environment')
    .option('--team <team>', 'filter by owning team')
    .action(async (opts, cmd: Command) => {
      const g = globals(cmd);
      const { buckets } = await clientFor(g).listBuckets({ environment: opts.environment, team: opts.team });
      console.log(
        render(g.output, buckets, () =>
          table(
            ['BUCKET', 'TEAM', 'ENV', 'CREATED', 'RETENTION', 'CLASS'],
            buckets.map((b: Bucket) => [
              b.bucketId,
              b.owningTeam,
              b.environment,
              b.createdAt,
              b.settings.retentionDays == null ? 'keep all' : `${b.settings.retentionDays}d`,
              b.settings.storageClass ?? 'STANDARD',
            ]),
          ),
        ),
      );
    });

  bucket
    .command('describe <bucketId>')
    .description('Show everything the platform knows about one bucket.')
    .action(async (bucketId: string, _opts, cmd: Command) => {
      const g = globals(cmd);
      const b = await clientFor(g).describeBucket(bucketId);
      console.log(
        render(g.output, b, () =>
          [
            keyValue([
              ['bucket', b.bucketId],
              ['team', b.owningTeam],
              ['environment', b.environment],
              ['requested by', b.requester],
              ['created', b.createdAt],
              ['stack', b.stackDir],
              ['request id', b.requestId],
            ]),
            '',
            'Settings (changeable):',
            keyValue([
              ['  retention', b.settings.retentionDays == null ? 'keep all versions' : `${b.settings.retentionDays} days`],
              ['  storage class', dash(b.settings.storageClass)],
              [
                '  extra labels',
                Object.entries(b.settings.extraLabels ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none',
              ],
            ]),
            '',
            'Guardrails (enforced by the platform):',
            keyValue([
              ['  location', b.guardrails.location],
              ['  uniform access', String(b.guardrails.uniformBucketLevelAccess)],
              ['  public access', b.guardrails.publicAccessPrevention],
              ['  versioning', String(b.guardrails.versioning)],
            ]),
          ].join('\n'),
        ),
      );
    });

  bucket
    .command('create')
    .description('Request a new bucket.')
    .requiredOption('--name <name>', 'short bucket name')
    .requiredOption('--team <team>', 'owning team id')
    .requiredOption('--env <environment>', 'environment (dev, test or prod)')
    .option('--requester <handle>', 'GitHub handle to record as the requester', process.env.USER)
    .option('--retention-days <days>', 'expire noncurrent versions after N days', (v) => Number(v))
    .addOption(new Option('--storage-class <class>', 'storage class').choices(['STANDARD', 'NEARLINE']))
    .option('--label <key=value>', 'extra label (repeatable)', (v: string, acc: string[]) => [...acc, v], [])
    .option('--dry-run', 'render the change without opening it')
    .option('--wait', 'poll until the request is done (or blocked), exiting non-zero if it did not succeed')
    .action(async (opts, cmd: Command) => {
      const g = globals(cmd);
      const client = clientFor(g);

      const settings = {
        ...(opts.retentionDays !== undefined ? { retentionDays: opts.retentionDays } : {}),
        ...(opts.storageClass ? { storageClass: opts.storageClass } : {}),
        ...(opts.label.length ? { extraLabels: parseLabels(opts.label) } : {}),
      };

      const result = await client.createBucket(
        {
          name: opts.name,
          owningTeam: opts.team,
          environment: opts.env,
          requester: opts.requester,
          ...(Object.keys(settings).length ? { settings } : {}),
        },
        opts.dryRun,
      );

      if (isDryRun(result)) {
        console.log(renderDryRun(result, g.output));
        return;
      }
      console.log(renderRequest(result, g.output));
      if (opts.wait) await waitAndExit(client, result.requestId, g);
    });

  bucket
    .command('update <bucketId>')
    .description("Change a bucket's mutable settings.")
    .option('--retention-days <days>', 'expire noncurrent versions after N days', (v) => Number(v))
    .option('--clear-retention', 'stop expiring noncurrent versions')
    .addOption(new Option('--storage-class <class>', 'storage class').choices(['STANDARD', 'NEARLINE']))
    .option('--label <key=value>', 'replace the extra labels (repeatable)', (v: string, acc: string[]) => [...acc, v], [])
    .option('--dry-run', 'render the change without opening it')
    .option('--wait', 'poll until the request is done (or blocked), exiting non-zero if it did not succeed')
    .action(async (bucketId: string, opts, cmd: Command) => {
      const g = globals(cmd);
      const client = clientFor(g);

      const patch = {
        // Explicit null resets to the platform default; omitting a field leaves it.
        ...(opts.clearRetention ? { retentionDays: null } : {}),
        ...(opts.retentionDays !== undefined ? { retentionDays: opts.retentionDays } : {}),
        ...(opts.storageClass ? { storageClass: opts.storageClass } : {}),
        ...(opts.label.length ? { extraLabels: parseLabels(opts.label) } : {}),
      };
      if (Object.keys(patch).length === 0) {
        throw new Error('Nothing to change — pass at least one setting.');
      }

      const result = await client.updateBucket(bucketId, patch, opts.dryRun);
      if (isDryRun(result)) {
        console.log(renderDryRun(result, g.output));
        return;
      }
      console.log(renderRequest(result, g.output));
      if (opts.wait) await waitAndExit(client, result.requestId, g);
    });

  bucket
    .command('delete <bucketId>')
    .description('Decommission a bucket.')
    .option('--dry-run', 'render the change without opening it')
    .option('--wait', 'poll until the request is done (or blocked), exiting non-zero if it did not succeed')
    .action(async (bucketId: string, opts, cmd: Command) => {
      const g = globals(cmd);
      const client = clientFor(g);
      const result = await client.deleteBucket(bucketId, opts.dryRun);
      if (isDryRun(result)) {
        console.log(renderDryRun(result, g.output));
        return;
      }
      console.log(renderRequest(result, g.output));
      if (opts.wait) await waitAndExit(client, result.requestId, g);
    });

  const requests = program.command('request').description('Track change requests.');

  requests
    .command('status <requestId>')
    .description('Show where a change request has got to.')
    .option('--wait', 'poll until the request is done (or blocked), exiting non-zero if it did not succeed')
    .action(async (requestId: string, opts, cmd: Command) => {
      const g = globals(cmd);
      const client = clientFor(g);
      if (opts.wait) {
        await waitAndExit(client, requestId, g);
        return;
      }
      console.log(renderRequest(await client.getRequest(requestId), g.output));
    });

  requests
    .command('list')
    .description('List change requests still in flight.')
    .action(async (_opts, cmd: Command) => {
      const g = globals(cmd);
      const { requests: rs } = await clientFor(g).listRequests();
      console.log(
        render(g.output, rs, () =>
          table(
            ['REQUEST', 'INTENT', 'STATUS', 'BUCKET', 'REVIEW'],
            rs.map((r) => [r.requestId, r.intent, statusLabel(r.status), r.bucketId, r.review.url]),
          ),
        ),
      );
    });

  program
    .command('status')
    .description('Platform delivery metrics and compliance.')
    .action(async (_opts, cmd: Command) => {
      const g = globals(cmd);
      const client = clientFor(g);
      const [metrics, comp] = await Promise.all([client.metrics(), client.compliance()]);
      console.log(
        render(g.output, { metrics, compliance: comp }, () =>
          [
            'Delivery',
            keyValue([
              ['  apply success rate', `${pct(metrics.applySuccessRate)} (${metrics.applySuccess}/${metrics.applyRuns})`],
              ['  median lead time', metrics.medianLeadTimeMins == null ? '-' : `${metrics.medianLeadTimeMins} min`],
            ]),
            '',
            'Compliance',
            keyValue([
              ['  policy pass rate', `${pct(comp.policyPassRate)} (${comp.policyPass}/${comp.policyRuns})`],
              ['  open drift', comp.openDrift.length === 0 ? 'none' : `${comp.openDrift.length}`],
            ]),
            ...(comp.openDrift.length
              ? ['', 'Drifted stacks:', ...comp.openDrift.map((d) => `  ${d.stack}  ${d.url}`)]
              : []),
          ].join('\n'),
        ),
      );
    });

  return program;
}

/**
 * Wait for a request to finish and exit accordingly. A CI job that asks the
 * platform for a bucket needs the shell to fail when the request was blocked or
 * the apply failed — otherwise the pipeline sails on without its bucket.
 */
async function waitAndExit(client: Client, requestId: string, g: GlobalOpts): Promise<void> {
  const final = await waitFor(client, requestId, (status) => {
    if (g.output === 'table') console.error(`  ${statusLabel(status)}`);
  });
  if (g.output !== 'table') console.log(render(g.output, final, () => ''));
  else console.log(renderRequest(final, g.output));
  if (UNSUCCESSFUL.includes(final.status)) process.exitCode = 1;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (e) {
    if (e instanceof ApiError) {
      // A problem document already says what went wrong and, for a validation
      // failure, which field — print that rather than a stack trace.
      console.error(`Error: ${e.problem.title}`);
      if (e.problem.detail) console.error(`  ${e.problem.detail}`);
      for (const f of e.problem.errors ?? []) console.error(`  ${f.field}: ${f.message}`);
    } else {
      console.error(`Error: ${(e as Error).message}`);
    }
    process.exitCode = 1;
  }
}
