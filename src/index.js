import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseDiff, matchesGlob, formatDiffForPrompt } from './diff.js';
import { reviewDiff } from './review.js';
import { fetchPRDiff, getHeadSha, postReviewComments, postSummaryComment } from './github.js';

async function run() {
  try {
    // ── Read inputs ──────────────────────────────────────────────────
    const apiKey = core.getInput('anthropic_api_key', { required: true });
    const model = core.getInput('model') || 'claude-sonnet-4-5-20250929';
    const maxTokens = parseInt(core.getInput('max_tokens') || '4096', 10);
    const reviewScope = core.getInput('review_scope') || 'bugs,security,logic';
    const severity = core.getInput('severity') || 'medium';
    const includePaths = core.getInput('include_paths')
      ? core.getInput('include_paths').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const excludePaths = core.getInput('exclude_paths')
      ? core.getInput('exclude_paths').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const maxFiles = parseInt(core.getInput('max_files') || '20', 10);
    const postSummary = core.getInput('post_summary') !== 'false';
    const githubToken = core.getInput('github_token', { required: true });

    // ── Validate context ─────────────────────────────────────────────
    const context = github.context;
    if (!context.payload.pull_request) {
      core.setFailed('This action must be triggered by a pull_request event.');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    core.info(`Reviewing PR #${prNumber}...`);

    // ── Fetch PR diff ────────────────────────────────────────────────
    const octokit = github.getOctokit(githubToken);
    const rawDiff = await fetchPRDiff(octokit, context);

    if (!rawDiff || rawDiff.trim().length === 0) {
      core.info('PR has no diff — nothing to review.');
      core.setOutput('comments_count', '0');
      core.setOutput('summary', 'No changes to review.');
      core.setOutput('files_reviewed', '0');
      return;
    }

    // ── Parse and filter files ───────────────────────────────────────
    let files = parseDiff(rawDiff);
    core.info(`Parsed ${files.length} file(s) from diff.`);

    // Apply include filter
    if (includePaths.length > 0) {
      files = files.filter(f => matchesGlob(f.path, includePaths));
      core.info(`After include filter: ${files.length} file(s).`);
    }

    // Apply exclude filter
    if (excludePaths.length > 0) {
      files = files.filter(f => !matchesGlob(f.path, excludePaths));
      core.info(`After exclude filter: ${files.length} file(s).`);
    }

    if (files.length === 0) {
      core.info('No reviewable files after filtering.');
      core.setOutput('comments_count', '0');
      core.setOutput('summary', 'No reviewable files in this PR.');
      core.setOutput('files_reviewed', '0');
      return;
    }

    // Check max_files limit
    if (maxFiles > 0 && files.length > maxFiles) {
      core.warning(
        `PR touches ${files.length} files (limit: ${maxFiles}). Skipping review to avoid excessive API cost.`
      );
      core.setOutput('comments_count', '0');
      core.setOutput('summary', `Skipped: PR has ${files.length} files (limit: ${maxFiles}).`);
      core.setOutput('files_reviewed', '0');
      return;
    }

    // ── Build prompt and call Claude ─────────────────────────────────
    const diffText = formatDiffForPrompt(files);
    const filePaths = files.map(f => f.path);

    const { summary, comments } = await reviewDiff({
      apiKey,
      model,
      maxTokens,
      diffText,
      reviewScope,
      severity,
      filePaths,
    });

    core.info(`Review complete: ${comments.length} comments, ${files.length} files reviewed.`);

    // ── Post comments ────────────────────────────────────────────────
    const commitSha = await getHeadSha(octokit, context);
    const postedCount = await postReviewComments(octokit, context, commitSha, comments);

    if (postSummary) {
      await postSummaryComment(octokit, context, summary, postedCount, files.length);
    }

    // ── Set outputs ──────────────────────────────────────────────────
    core.setOutput('comments_count', String(postedCount));
    core.setOutput('summary', summary);
    core.setOutput('files_reviewed', String(files.length));

  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
