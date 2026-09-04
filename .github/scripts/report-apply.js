// apply.yml — the audit-trail comment posted back on the PR that requested the
// bucket. The Actions run and GCP audit logs remain the authoritative trail;
// this just surfaces the outcome where the request was made.
const { readOr, footer, findOriginatingPR, upsertComment } = require('./gh-comment.js');

module.exports = async function reportApply({ github, context, core, stack, outcome }) {
  const pr = await findOriginatingPR({ github, context, core });
  if (!pr) return;

  let outputs = {};
  try {
    outputs = JSON.parse(readOr('/tmp/outputs.json', '{}'));
  } catch (e) {
    /* malformed outputs shouldn't lose the audit comment */
  }
  const bucket = outputs.bucket_name?.value ?? '(n/a)';
  const label = outcome === 'success' ? '✅ Applied' : '❌ Apply failed';
  const marker = `<!-- tf-apply:${stack} -->`;

  const body = [
    marker,
    `### ${label} — \`${stack}\``,
    outcome === 'success'
      ? `Provisioned **\`${bucket}\`** via Workload Identity Federation.`
      : `Apply failed — see the run for details.`,
    '',
    `- Outputs: \`${JSON.stringify(outputs)}\``,
    footer(context, 'Apply run'),
  ].join('\n');

  await upsertComment({ github, context, issue_number: pr.number, marker, body });
};
