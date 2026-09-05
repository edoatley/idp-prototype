import { Router } from 'express';
import {
  loadConfig,
  listBuckets,
  validate,
  validateSettings,
  generateRequestId,
  planCreate,
  planUpdate,
  planDelete,
  mergeSettings,
  GitHubPrDriver,
  DryRunDriver,
  dryRunResult,
  type BucketRecord,
  type BucketSettings,
  type ChangeRequest,
  type ChangeDriver,
} from 'idp-core';
import { asyncRoute, badRequest, notFound, conflict } from './problem';
import { requireToken, repoFromEnv } from './auth';

// The write surface. Every route here does the same three things: build a
// ChangeRequest through idp-core, refuse if something is already in flight, and
// hand it to a driver. The routes hold no knowledge of PRs, branches or commits.

const today = () => new Date().toISOString().slice(0, 10);

interface SettingsPatch {
  retentionDays?: number | null;
  storageClass?: 'STANDARD' | 'NEARLINE';
  extraLabels?: Record<string, string>;
}

/** The API's `Request` representation of a change that was just submitted. */
function acceptedRequest(change: ChangeRequest, submitted: { number: number; url: string }) {
  return {
    requestId: change.requestId,
    intent: change.intent,
    status: 'pending_review' as const,
    bucketId: change.target.bucketName,
    stackDir: change.target.stackDir,
    submittedAt: new Date().toISOString(),
    review: { url: submitted.url, number: submitted.number },
  };
}

export function writeRouter(): Router {
  const router = Router();

  const driverFor = (req: Parameters<typeof requireToken>[0]): ChangeDriver =>
    new GitHubPrDriver({ token: requireToken(req), ...repoFromEnv() });

  /**
   * One writer at a time. Two open changes against the same stack would race on
   * shared Terraform state and the second would be planned against a base that
   * no longer reflects the first — so the platform refuses rather than letting a
   * caller discover the conflict at apply time.
   */
  async function refuseIfInFlight(driver: ChangeDriver, bucketId: string): Promise<void> {
    const open = await driver.listOpen();
    const existing = open.find((r) => r.bucketId === bucketId);
    if (existing) {
      throw conflict(
        `A ${existing.intent} request (${existing.requestId}) is already open against ${bucketId}: ${existing.review.url}. Merge or close it first.`,
        '/problems/request-in-flight',
      );
    }
  }

  async function submit(
    req: Parameters<typeof requireToken>[0],
    res: Parameters<Parameters<typeof asyncRoute>[0]>[1],
    change: ChangeRequest,
    opts: { checkInFlight: boolean },
  ): Promise<void> {
    // The validator coerces the query param, so it can arrive as a boolean or
    // a string depending on how it was sent.
    if (String(req.query.dryRun) === 'true') {
      await new DryRunDriver().submit(change);
      res.status(200).json(dryRunResult(change));
      return;
    }

    const driver = driverFor(req);
    if (opts.checkInFlight) await refuseIfInFlight(driver, change.target.bucketName);

    let submitted;
    try {
      submitted = await driver.submit(change);
    } catch (e) {
      // The driver's collision guard is the authority on "already exists"; it
      // reads the base branch, which the local working tree may lag behind.
      const message = (e as Error).message;
      if (/already exists/.test(message)) throw conflict(message, '/problems/bucket-exists');
      throw e;
    }

    res
      .status(202)
      .location(`/v1/requests/${change.requestId}`)
      .json(acceptedRequest(change, submitted));
  }

  const findRecord = (bucketId: string): BucketRecord => {
    const record = listBuckets().find((b) => b.bucketName === bucketId);
    if (!record) throw notFound(`No bucket ${bucketId}.`);
    return record;
  };

  const shortNameOf = (record: BucketRecord): string => {
    const dirName = record.stackDir.split('/').pop() ?? '';
    const prefix = `${record.owning_team}-`;
    return dirName.startsWith(prefix) ? dirName.slice(prefix.length) : dirName;
  };

  const raise = (errors: Array<{ field: string; message: string }>) => {
    if (errors.length) throw badRequest('The request violates a platform convention.', errors);
  };

  router.post(
    '/v1/buckets',
    asyncRoute(async (req, res) => {
      const body = req.body as {
        name: string;
        owningTeam: string;
        environment: string;
        requester: string;
        settings?: SettingsPatch;
      };
      const input = { name: body.name, owning_team: body.owningTeam, environment: body.environment };

      // The schema check has already run; this is the platform's own rule set —
      // known teams, known environments, reserved labels — which a JSON schema
      // cannot express and which must hold for non-HTTP callers too.
      raise([...validate(input, loadConfig()), ...validateSettings(body.settings as Partial<BucketSettings>)]);

      const change = planCreate({
        request: input,
        requester: body.requester,
        requestId: generateRequestId(input.owning_team, input.name),
        date: today(),
        settings: body.settings as Partial<BucketSettings>,
      });

      // A stack the platform already knows about is a conflict we can answer
      // immediately, without spending a round trip on GitHub.
      if (listBuckets().some((b) => b.bucketName === change.target.bucketName)) {
        throw conflict(`Bucket ${change.target.bucketName} already exists.`, '/problems/bucket-exists');
      }

      await submit(req, res, change, { checkInFlight: true });
    }),
  );

  router.patch(
    '/v1/buckets/:bucketId',
    asyncRoute(async (req, res) => {
      const record = findRecord(req.params.bucketId!);
      const patch = req.body as SettingsPatch;

      raise(validateSettings(patch as Partial<BucketSettings>));

      const settings = mergeSettings(record.settings, patch as Partial<BucketSettings>);
      const change = planUpdate({
        record,
        name: shortNameOf(record),
        settings,
        // The change's author is whoever holds the token; the bucket's original
        // requester stays untouched as provenance.
        requester: (req.get('x-idp-requester') ?? record.requester) || 'idp-api',
        requestId: generateRequestId(record.owning_team, shortNameOf(record)),
        date: today(),
      });

      await submit(req, res, change, { checkInFlight: true });
    }),
  );

  router.delete(
    '/v1/buckets/:bucketId',
    asyncRoute(async (req, res) => {
      const record = findRecord(req.params.bucketId!);
      const change = planDelete({
        record,
        requester: (req.get('x-idp-requester') ?? record.requester) || 'idp-api',
        requestId: generateRequestId(record.owning_team, 'decommission'),
      });

      await submit(req, res, change, { checkInFlight: true });
    }),
  );

  router.get(
    '/v1/requests',
    asyncRoute(async (req, res) => {
      res.json({ requests: await driverFor(req).listOpen() });
    }),
  );

  router.get(
    '/v1/requests/:requestId',
    asyncRoute(async (req, res) => {
      const status = await driverFor(req).status(req.params.requestId!);
      if (!status) throw notFound(`No request ${req.params.requestId}.`);
      res.json(status);
    }),
  );

  return router;
}
