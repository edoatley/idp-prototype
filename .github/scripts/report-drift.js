// drift.yml — the scheduled drift report for one stack.
//
// Drift gets its own GitHub Issue per stack rather than a PR comment: there is
// no PR to hang it off, and an open Issue is what the portal's compliance panel
// counts (idp-portal/src/compliance.ts filters open issues by /^Drift:/, so the
// `Drift: <stack>` title below is a load-bearing contract, not decoration).
// The issue is opened/updated on drift and closed again once the stack matches.
const { readOr, fence, runUrl } = require('./gh-comment.js');

module.exports = async function reportDrift({ github, context, core, stack, exitCode }) {
  // terraform plan -detailed-exitcode: 0 = no drift, 2 = drift, 1 = real error.
  const drift = exitCode === '2';
  const { owner, repo } = context.repo;
  const marker = `<!-- drift:${stack} -->`;
  const url = runUrl(context);

  core.summary.addRaw(`- \`${stack}\`: ${drift ? '⚠️ DRIFT' : '✅ in sync'}\n`);
  await core.summary.write();

  // Find this stack's existing drift issue by its marker.
  const { data: open } = await github.rest.issues.listForRepo({ owner, repo, state: 'open', per_page: 100 });
  const existing = open.find((i) => (i.body ?? '').includes(marker));

  if (!drift) {
    if (existing) {
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: existing.number,
        body: `✅ Drift cleared — \`${stack}\` matches Terraform again. [run](${url})`,
      });
      await github.rest.issues.update({ owner, repo, issue_number: existing.number, state: 'closed' });
    }
    return;
  }

  const plan = fence(readOr('/tmp/plan.txt', 'No plan output captured.'));
  const title = `Drift: ${stack}`;
  const body = [
    marker,
    `Drift detected on \`${stack}\` — the live resource no longer matches its Terraform.`,
    '',
    '<details><summary>terraform plan</summary>',
    '',
    '```',
    plan,
    '```',
    '</details>',
    '',
    `[Drift run](${url}) · ${new Date().toISOString()}`,
  ].join('\n');

  if (existing) {
    await github.rest.issues.update({ owner, repo, issue_number: existing.number, title, body, state: 'open' });
  } else {
    await github.rest.issues.create({ owner, repo, title, body });
  }
};
