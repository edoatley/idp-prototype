// Shared plumbing for the workflow steps that report back onto a PR or Issue.
//
// Loaded by actions/github-script, which supplies `github` (an authenticated
// Octokit), `context` and `core`. There is no npm install on the runner and
// never will be: keep this CommonJS and dependency-free — Node builtins only.
//
// Only genuinely shared mechanics live here. The wording of each report stays
// in its own report-*.js so the interesting part is one file per workflow.

const fs = require('fs');

// Fenced plan/policy output is truncated well short of GitHub's 65 536-char
// body limit, leaving room for the surrounding markdown.
const PLAN_LIMIT = 55000;
const BODY_LIMIT = 65000;

/** Read a file, or return `fallback` if it is missing/unreadable. */
function readOr(path, fallback) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (e) {
    return fallback;
  }
}

/** Truncate text destined for a fenced code block. */
function fence(text, limit = PLAN_LIMIT) {
  return text.length > limit ? text.slice(0, limit) + '\n... (truncated)' : text;
}

/** Permalink to the run that is posting the report. */
function runUrl(context) {
  const { owner, repo } = context.repo;
  return `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
}

/** The trailing provenance line every report ends with. */
function footer(context, label) {
  return `- [${label}](${runUrl(context)}) · commit \`${context.sha.slice(0, 7)}\` · ${new Date().toISOString()}`;
}

/**
 * apply/destroy run on push to main, not on the PR — so to close the audit loop
 * we find the PR the merge commit came from. Returns null (and logs) if there
 * is none, e.g. a direct push.
 */
async function findOriginatingPR({ github, context, core }) {
  const { owner, repo } = context.repo;
  const { data: prs } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: context.sha,
  });
  const pr = prs.find((p) => p.merged_at) ?? prs[0];
  if (!pr) {
    core.info('No PR associated with this commit; skipping comment.');
    return null;
  }
  return pr;
}

/**
 * Post `body` as a sticky comment: if a comment containing `marker` already
 * exists, update it in place, otherwise create one. Keeps re-runs from piling
 * up duplicates.
 */
async function upsertComment({ github, context, issue_number, marker, body }) {
  const { owner, repo } = context.repo;
  if (body.length > BODY_LIMIT) body = body.slice(0, BODY_LIMIT) + '\n... (truncated)';
  const { data: comments } = await github.rest.issues.listComments({ owner, repo, issue_number });
  const existing = comments.find((c) => c.body.includes(marker));
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body });
  }
}

module.exports = { PLAN_LIMIT, BODY_LIMIT, readOr, fence, runUrl, footer, findOriginatingPR, upsertComment };
