import express from 'express';
import {
  loadConfig,
  validate,
  generateRequestId,
  planCreate,
  planDelete,
  GitHubPrDriver,
  listBuckets,
  deliveryMetrics,
  compliance,
  type PlatformConfig,
  type BucketRequest,
  type FieldError,
  type BucketRecord,
  type DeliveryMetrics,
  type Compliance,
} from 'idp-core';
import { mountApi } from './api';

// The human surface: a form -> validate -> submit a change -> show the PR.
// The change layer in idp-core does the actual work, so this file is only
// HTML and the JSON API next door goes through exactly the same path.
// No GCP creds here; the only secret is the GitHub PAT (GITHUB_TOKEN).

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input,select{width:100%;padding:.5rem;font-size:1rem}
button{margin-top:1.5rem;padding:.6rem 1.2rem;font-size:1rem}.err{color:#b00020}.ok{color:#0a7d28}
code{background:#f2f2f2;padding:.1rem .3rem;border-radius:3px}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{text-align:left;padding:.4rem .6rem}
h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}</style></head><body>
<h1>${esc(title)}</h1>${inner}</body></html>`;
}

function renderForm(config: PlatformConfig, values: Partial<BucketRequest & { requester: string }> = {}, errors: FieldError[] = []): string {
  const errFor = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? `<div class="err">${esc(e.message)}</div>` : '';
  };
  const teamOpts = config.teams
    .map((t) => `<option value="${esc(t.id)}"${values.owning_team === t.id ? ' selected' : ''}>${esc(t.name)} (${esc(t.id)})</option>`)
    .join('');
  const envOpts = config.environments
    .map((e) => `<option value="${esc(e)}"${values.environment === e ? ' selected' : ''}>${esc(e)}</option>`)
    .join('');
  return page(
    'Request a GCS bucket',
    `<p>Pick three things; the platform enforces the rest and opens a reviewable PR.</p>
<p><a href="/buckets">View existing buckets →</a> · <a href="/dashboard">Oversight dashboard →</a></p>
<form method="post" action="/buckets">
  <label>Bucket name <small>(lowercase, 3–30 chars)</small></label>
  <input name="name" value="${esc(values.name ?? '')}" placeholder="orders">${errFor('name')}
  <label>Owning team</label>
  <select name="owning_team">${teamOpts}</select>${errFor('owning_team')}
  <label>Environment</label>
  <select name="environment">${envOpts}</select>${errFor('environment')}
  <label>Your GitHub handle</label>
  <input name="requester" value="${esc(values.requester ?? '')}" placeholder="octocat">
  <button type="submit">Open PR</button>
</form>`,
  );
}

function renderInventory(): string {
  const buckets = listBuckets();
  if (buckets.length === 0) {
    return page('Buckets', '<p>No buckets yet.</p><p><a href="/">Request one →</a></p>');
  }
  const rows = buckets
    .map(
      (b) => `<tr>
  <td><code>${esc(b.bucketName)}</code></td>
  <td>${esc(b.owning_team)}</td>
  <td>${esc(b.environment)}</td>
  <td>${esc(b.created_at)}</td>
  <td><form method="post" action="/buckets/decommission" onsubmit="return confirm('Open a PR to decommission ${esc(b.bucketName)}?')">
    <input type="hidden" name="stackDir" value="${esc(b.stackDir)}">
    <button type="submit">Decommission</button>
  </form></td>
</tr>`,
    )
    .join('');
  return page(
    'Buckets',
    `<p><a href="/">← Request a bucket</a></p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
<thead><tr><th>Bucket</th><th>Team</th><th>Env</th><th>Created</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>`,
  );
}

const pct = (n: number | null): string => (n == null ? '—' : `${Math.round(n * 100)}%`);
const mins = (n: number | null): string => (n == null ? '—' : `${n} min`);

function renderDashboard(buckets: BucketRecord[], metrics: DeliveryMetrics | null, comp: Compliance | null, note: string): string {
  const invRows = buckets.length
    ? buckets
        .map(
          (b) => `<tr><td><code>${esc(b.bucketName)}</code></td><td>${esc(b.owning_team)}</td><td>${esc(b.environment)}</td><td>${esc(b.type)}</td><td>${esc(b.created_at)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5">No buckets.</td></tr>';

  const delivery = metrics
    ? `<ul>
  <li>Apply success rate: <strong>${pct(metrics.applySuccessRate)}</strong> (${metrics.applySuccess}/${metrics.applyRuns} completed apply runs)</li>
  <li>Median lead time (PR opened → merged): <strong>${mins(metrics.medianLeadTimeMins)}</strong></li>
</ul>
${
  metrics.recent.length
    ? `<table border="1" cellpadding="6"><thead><tr><th>PR</th><th>Request</th><th>Lead time</th></tr></thead><tbody>${metrics.recent
        .map(
          (r) => `<tr><td><a href="${esc(r.url)}">#${r.number}</a></td><td>${esc(r.title)}</td><td>${mins(r.leadTimeMins)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>No request PRs yet.</p>'
}`
    : '<p><em>Delivery metrics need <code>GITHUB_TOKEN</code> + <code>GITHUB_REPO</code>.</em></p>';

  const complianceHtml = comp
    ? `<ul>
  <li>Policy pass-rate (pr.yml runs): <strong>${pct(comp.policyPassRate)}</strong> (${comp.policyPass}/${comp.policyRuns})</li>
  <li>Open drift: <strong>${comp.openDrift.length === 0 ? '✅ none' : `⚠️ ${comp.openDrift.length}`}</strong></li>
</ul>
${comp.openDrift.length ? `<ul>${comp.openDrift.map((d) => `<li><a href="${esc(d.url)}"><code>${esc(d.stack)}</code></a></li>`).join('')}</ul>` : ''}`
    : '<p><em>Compliance needs <code>GITHUB_TOKEN</code> + <code>GITHUB_REPO</code>.</em></p>';

  return page(
    'Oversight dashboard',
    `<p><a href="/">← Request a bucket</a> · <a href="/buckets">Buckets</a></p>
${note ? `<p class="err">${esc(note)}</p>` : ''}
<h2>Inventory &amp; ownership</h2>
<table border="1" cellpadding="6"><thead><tr><th>Bucket</th><th>Team</th><th>Env</th><th>Type</th><th>Created</th></tr></thead><tbody>${invRows}</tbody></table>
<h2>Delivery metrics</h2>
${delivery}
<h2>Compliance &amp; drift</h2>
${complianceHtml}
<p><small>Aggregated on demand from the GitOps repo + GitHub API — no datastore. Lead time = PR opened→merged; policy pass-rate proxies the gate via pr.yml run outcomes.</small></p>`,
  );
}

function githubEnv(): { owner: string; repo: string; token: string } | null {
  const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) return null;
  return { owner, repo, token };
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const config = loadConfig();

  app.get('/', (_req, res) => res.send(renderForm(config)));

  app.post('/buckets', async (req, res) => {
    const input: BucketRequest = {
      name: String(req.body.name ?? '').trim(),
      owning_team: String(req.body.owning_team ?? '').trim(),
      environment: String(req.body.environment ?? '').trim(),
    };
    const requester = String(req.body.requester ?? '').trim();

    const errors = validate(input, config);
    if (!requester) errors.push({ field: 'name', message: 'requester (your GitHub handle) is required.' });
    if (errors.length) return res.status(400).send(renderForm(config, { ...input, requester }, errors));

    const gh = githubEnv();
    if (!gh) {
      return res.status(500).send(page('Config error', '<p class="err">GITHUB_REPO and GITHUB_TOKEN must be set.</p>'));
    }

    // The form goes through the same change layer as the API and the CLI: one
    // place decides what a request becomes, so all three produce identical PRs.
    const change = planCreate({
      request: input,
      requester,
      requestId: generateRequestId(input.owning_team, input.name),
      date: new Date().toISOString().slice(0, 10),
    });

    try {
      const submitted = await new GitHubPrDriver(gh).submit(change);
      res.send(
        page(
          'PR opened',
          `<p class="ok">✅ Opened <a href="${esc(submitted.url)}">PR #${submitted.number}</a> for <code>${esc(change.target.bucketName)}</code>.</p>
<p>CI is planning + running the policy gate now. Review and merge to provision.</p>
<p><a href="/">Request another</a></p>`,
        ),
      );
    } catch (e) {
      res.status(500).send(page('Error', `<p class="err">${esc((e as Error).message)}</p><p><a href="/">Back</a></p>`));
    }
  });

  app.get('/buckets', (_req, res) => res.send(renderInventory()));

  app.get('/dashboard', async (_req, res) => {
    const buckets = listBuckets();
    const gh = githubEnv();
    if (!gh) {
      return res.send(renderDashboard(buckets, null, null, 'Set GITHUB_TOKEN + GITHUB_REPO to see delivery + compliance metrics.'));
    }
    // Aggregate on demand; keep each panel resilient so one API hiccup doesn't blank the page.
    let metrics: DeliveryMetrics | null = null;
    let comp: Compliance | null = null;
    let note = '';
    try {
      metrics = await deliveryMetrics(gh);
    } catch (e) {
      note += `Delivery metrics unavailable: ${(e as Error).message}. `;
    }
    try {
      comp = await compliance(gh);
    } catch (e) {
      note += `Compliance unavailable: ${(e as Error).message}.`;
    }
    res.send(renderDashboard(buckets, metrics, comp, note));
  });

  app.post('/buckets/decommission', async (req, res) => {
    const stackDir = String(req.body.stackDir ?? '').trim();
    const record = listBuckets().find((b) => b.stackDir === stackDir);
    if (!record) {
      return res.status(400).send(page('Error', `<p class="err">Unknown stack: ${esc(stackDir)}</p><p><a href="/buckets">Back</a></p>`));
    }
    const gh = githubEnv();
    if (!gh) {
      return res.status(500).send(page('Config error', '<p class="err">GITHUB_REPO and GITHUB_TOKEN must be set.</p>'));
    }
    const change = planDelete({
      record,
      requester: record.requester || 'idp-portal',
      requestId: generateRequestId(record.owning_team, 'decommission'),
    });

    try {
      const submitted = await new GitHubPrDriver(gh).submit(change);
      res.send(
        page(
          'Decommission PR opened',
          `<p class="ok">♻️ Opened <a href="${esc(submitted.url)}">PR #${submitted.number}</a> to decommission <code>${esc(record.bucketName)}</code>.</p>
<p>Review and merge to destroy via WIF.</p>
<p><a href="/buckets">Back to buckets</a></p>`,
        ),
      );
    } catch (e) {
      res.status(500).send(page('Error', `<p class="err">${esc((e as Error).message)}</p><p><a href="/buckets">Back</a></p>`));
    }
  });

  // The machine surface, mounted last so the HTML routes above keep their paths.
  // Both surfaces read and write through idp-core, never through each other.
  mountApi(app);

  return app;
}

export function start(): void {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`idp-portal listening on http://localhost:${port}`));
}

if (require.main === module) start();
