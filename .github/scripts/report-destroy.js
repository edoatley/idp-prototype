// destroy.yml — the decommission audit comment. The stack's files are gone by
// the time this runs, so the bucket name is re-derived from the stack path
// rather than read from Terraform outputs.
const { footer, findOriginatingPR, upsertComment } = require('./gh-comment.js');

module.exports = async function reportDestroy({ github, context, core, stack, outcome }) {
  const pr = await findOriginatingPR({ github, context, core });
  if (!pr) return;

  const parts = stack.split('/'); // idp-gitops/stacks/<env>/<team>-<name>
  const bucket = `edo-${parts[2]}-${parts[3]}`;
  const label = outcome === 'success' ? '♻️ Decommissioned' : '❌ Decommission failed';
  const marker = `<!-- tf-destroy:${stack} -->`;

  const body = [
    marker,
    `### ${label} — \`${stack}\``,
    outcome === 'success'
      ? `Destroyed **\`${bucket}\`** and its resources.`
      : `Destroy failed — a non-empty bucket must be emptied first. See the run.`,
    '',
    footer(context, 'Destroy run'),
  ].join('\n');

  await upsertComment({ github, context, issue_number: pr.number, marker, body });
};
