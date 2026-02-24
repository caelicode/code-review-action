import * as core from '@actions/core';
import * as github from '@actions/github';

const SEVERITY_EMOJI = {
  critical: '\u{1F534}',  // 🔴
  warning: '\u{1F7E1}',   // 🟡
  suggestion: '\u{1F535}', // 🔵
};

const SEVERITY_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  suggestion: 'Suggestion',
};

/**
 * Fetch the raw diff for a pull request.
 *
 * @param {object} octokit — authenticated Octokit instance
 * @param {object} context — GitHub Actions context
 * @returns {Promise<string>} — raw unified diff
 */
export async function fetchPRDiff(octokit, context) {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request?.number;

  if (!pullNumber) {
    throw new Error('This action must be triggered by a pull_request event');
  }

  core.info(`Fetching diff for PR #${pullNumber}...`);

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: 'diff' },
  });

  // The diff comes back as a string when using mediaType diff
  return typeof data === 'string' ? data : String(data);
}

/**
 * Get the latest commit SHA on the PR (needed for review comments).
 */
export async function getHeadSha(octokit, context) {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request?.number;

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return pr.head.sha;
}

/**
 * Post inline review comments on a PR.
 *
 * @param {object} octokit — authenticated Octokit instance
 * @param {object} context — GitHub Actions context
 * @param {string} commitSha — HEAD commit SHA of the PR
 * @param {{ path: string, line: number, severity: string, body: string }[]} comments
 * @returns {Promise<number>} — number of comments successfully posted
 */
export async function postReviewComments(octokit, context, commitSha, comments) {
  if (comments.length === 0) {
    core.info('No review comments to post.');
    return 0;
  }

  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request.number;

  // Format comments with severity badges
  const reviewComments = comments.map(c => ({
    path: c.path,
    line: c.line,
    side: 'RIGHT',
    body: `${SEVERITY_EMOJI[c.severity] || SEVERITY_EMOJI.suggestion} **${SEVERITY_LABEL[c.severity] || 'Note'}**: ${c.body}`,
  }));

  core.info(`Posting ${reviewComments.length} review comments on PR #${pullNumber}...`);

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments: reviewComments,
    });

    core.info(`Successfully posted ${reviewComments.length} comments.`);
    return reviewComments.length;
  } catch (err) {
    // If the batch fails (e.g., invalid line number), try posting individually
    core.warning(`Batch review failed (${err.message}). Posting comments individually...`);
    return await postCommentsIndividually(octokit, owner, repo, pullNumber, commitSha, reviewComments);
  }
}

async function postCommentsIndividually(octokit, owner, repo, pullNumber, commitSha, comments) {
  let posted = 0;

  for (const comment of comments) {
    try {
      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitSha,
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: comment.body,
      });
      posted++;
    } catch (err) {
      core.warning(`Failed to post comment on ${comment.path}:${comment.line} — ${err.message}`);
    }
  }

  core.info(`Posted ${posted}/${comments.length} comments individually.`);
  return posted;
}

/**
 * Post a summary comment on the PR.
 */
export async function postSummaryComment(octokit, context, summary, commentsCount, filesReviewed) {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request.number;

  const body = [
    '## AI Code Review Summary',
    '',
    summary,
    '',
    `---`,
    `*Reviewed ${filesReviewed} file${filesReviewed !== 1 ? 's' : ''} · ${commentsCount} comment${commentsCount !== 1 ? 's' : ''} · Powered by [CaeliCode Code Review](https://github.com/caelicode/code-review-action)*`,
  ].join('\n');

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });

  core.info('Posted summary comment.');
}
