// pr.yml — the sticky "Terraform plan + policy gate" comment on a PR.
// Sections are collapsed so a long plan doesn't drown the conversation.
const { readOr, fence, upsertComment } = require('./gh-comment.js');

module.exports = async function reportPlan({ github, context, core, stack, planOutcome, policyOutcome }) {
  const marker = `<!-- tf-plan:${stack} -->`;
  const plan = fence(readOr('/tmp/plan.txt', 'No plan output captured.'));
  const policy = readOr('/tmp/policy.txt', 'Policy gate did not run (plan failed).');
  const policyLabel =
    policyOutcome === 'success' ? '✅ PASS'
    : policyOutcome === 'failure' ? '❌ FAIL — merge blocked'
    : '⏭️ skipped';

  const body = [
    marker,
    `### Terraform plan — \`${stack}\` (${planOutcome})`,
    '<details><summary>plan output</summary>',
    '',
    '```',
    plan,
    '```',
    '</details>',
    '',
    `### Policy gate — ${policyLabel}`,
    '<details><summary>conftest output</summary>',
    '',
    '```',
    policy,
    '```',
    '</details>',
  ].join('\n');

  await upsertComment({ github, context, issue_number: context.issue.number, marker, body });
};
