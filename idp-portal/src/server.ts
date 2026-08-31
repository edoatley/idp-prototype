import express from 'express';
import { loadConfig, type PlatformConfig } from './config';
import { validate, type BucketRequest, type FieldError } from './validate';
import { generate } from './generator';
import { generateRequestId } from './requestId';
import { openBucketPR } from './github';

// The thin write-path UI: a form -> validate -> generate stack -> open PR.
// No GCP creds here; the only secret is the GitHub PAT (GITHUB_TOKEN).

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input,select{width:100%;padding:.5rem;font-size:1rem}
button{margin-top:1.5rem;padding:.6rem 1.2rem;font-size:1rem}.err{color:#b00020}.ok{color:#0a7d28}
code{background:#f2f2f2;padding:.1rem .3rem;border-radius:3px}</style></head><body>
<h1>Request a GCS bucket</h1>${inner}</body></html>`;
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

    const requestId = generateRequestId(input.owning_team, input.name);
    const stack = generate(input, { requester, requestId, date: new Date().toISOString().slice(0, 10) });

    const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
    const token = process.env.GITHUB_TOKEN;
    if (!owner || !repo || !token) {
      return res.status(500).send(page('Config error', '<p class="err">GITHUB_REPO and GITHUB_TOKEN must be set.</p>'));
    }

    try {
      const pr = await openBucketPR({
        token,
        owner,
        repo,
        branch: `portal/${input.environment}-${input.owning_team}-${input.name}`,
        stack,
        title: `Provision bucket ${stack.bucketName}`,
        body: `Requested via idp-portal by @${requester}.\n\nStack: \`${stack.stackDir}\` · request-id \`${requestId}\`.\n\nPR CI will plan + run the policy gate; merge to provision via WIF.`,
      });
      res.send(
        page(
          'PR opened',
          `<p class="ok">✅ Opened <a href="${esc(pr.url)}">PR #${pr.number}</a> for <code>${esc(stack.bucketName)}</code>.</p>
<p>CI is planning + running the policy gate now. Review and merge to provision.</p>
<p><a href="/">Request another</a></p>`,
        ),
      );
    } catch (e) {
      res.status(500).send(page('Error', `<p class="err">${esc((e as Error).message)}</p><p><a href="/">Back</a></p>`));
    }
  });

  return app;
}

export function start(): void {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`idp-portal listening on http://localhost:${port}`));
}

if (require.main === module) start();
