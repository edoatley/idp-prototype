import { Router } from 'express';
import { listBuckets, loadConfig, deliveryMetrics, compliance } from 'idp-core';
import { asyncRoute, notFound, upstreamUnavailable } from './problem';
import { requireToken, repoFromEnv } from './auth';
import { toBucket } from './mappers';

// The JSON surface described by contracts/openapi.yaml. Every handler is a thin
// translation over idp-core — the portal's HTML pages call the same functions,
// so the two surfaces cannot disagree about what the platform contains.

export function apiRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/v1/catalog/teams', (_req, res) => {
    res.json({ teams: loadConfig().teams });
  });

  router.get('/v1/catalog/environments', (_req, res) => {
    const cfg = loadConfig();
    res.json({ environments: cfg.environments, orgPrefix: cfg.orgPrefix, region: cfg.region });
  });

  router.get('/v1/buckets', (req, res) => {
    const { environment, team } = req.query as { environment?: string; team?: string };
    const buckets = listBuckets()
      .filter((b) => !environment || b.environment === environment)
      .filter((b) => !team || b.owning_team === team)
      .map(toBucket);
    res.json({ buckets });
  });

  router.get('/v1/buckets/:bucketId', (req, res) => {
    const record = listBuckets().find((b) => b.bucketName === req.params.bucketId);
    if (!record) throw notFound(`No bucket ${req.params.bucketId}.`);
    res.json(toBucket(record));
  });

  // The oversight aggregates reach the GitHub API, so they need the caller's
  // token. An upstream hiccup is reported as 502 — the platform being unable to
  // answer is a different thing from the platform having nothing to report.
  router.get(
    '/v1/metrics',
    asyncRoute(async (req, res) => {
      const token = requireToken(req);
      try {
        res.json(await deliveryMetrics({ token, ...repoFromEnv() }));
      } catch (e) {
        throw upstreamUnavailable((e as Error).message);
      }
    }),
  );

  router.get(
    '/v1/compliance',
    asyncRoute(async (req, res) => {
      const token = requireToken(req);
      try {
        res.json(await compliance({ token, ...repoFromEnv() }));
      } catch (e) {
        throw upstreamUnavailable((e as Error).message);
      }
    }),
  );

  return router;
}
