import Anthropic from '@anthropic-ai/sdk';
import * as core from '@actions/core';

/**
 * Send parsed diff to Claude for review and return structured comments.
 *
 * @param {object} options
 * @param {string} options.apiKey — Anthropic API key
 * @param {string} options.model — Claude model ID
 * @param {number} options.maxTokens — Max response tokens
 * @param {string} options.diffText — Formatted diff with line numbers
 * @param {string} options.reviewScope — Comma-separated focus areas
 * @param {string} options.severity — Minimum severity: low, medium, high
 * @param {string[]} options.filePaths — List of file paths being reviewed
 * @returns {Promise<{ summary: string, comments: { path: string, line: number, body: string, severity: string }[] }>}
 */
export async function reviewDiff({
  apiKey,
  model,
  maxTokens,
  diffText,
  reviewScope,
  severity,
  filePaths,
}) {
  const client = new Anthropic({ apiKey });

  const systemPrompt = buildSystemPrompt(reviewScope, severity, filePaths);

  core.info(`Sending ${diffText.length} characters to Claude (${model})...`);

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Review this pull request diff:\n\n${diffText}`,
        },
      ],
    });
  } catch (err) {
    if (err.status === 401) {
      throw new Error('Invalid Anthropic API key — check your ANTHROPIC_API_KEY secret');
    }
    if (err.status === 429) {
      throw new Error('Anthropic rate limit exceeded — try again later or use a different model');
    }
    throw new Error(`Anthropic API error: ${err.message}`);
  }

  const text = response.content?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Claude');
  }

  core.info(
    `Claude response: ${response.usage?.input_tokens ?? '?'} input tokens, ` +
    `${response.usage?.output_tokens ?? '?'} output tokens`
  );

  return parseReviewResponse(text);
}

function buildSystemPrompt(reviewScope, severity, filePaths) {
  const severityGuide = {
    low: 'Comment on all issues including minor suggestions and improvements.',
    medium: 'Only comment on bugs, security vulnerabilities, logic errors, race conditions, resource leaks, and error handling gaps. Skip style and formatting nits.',
    high: 'Only comment on critical issues: security vulnerabilities, data loss risks, crashes, and severe bugs. Ignore everything else.',
  };

  return `You are a senior code reviewer analyzing a pull request diff.

## Focus Areas
${reviewScope.split(',').map(s => `- ${s.trim()}`).join('\n')}

## Severity Filter
${severityGuide[severity] || severityGuide.medium}

## Files Under Review
${filePaths.map(p => `- ${p}`).join('\n')}

## Rules
- Only flag genuine issues — do NOT manufacture problems or pad the review
- If the code is well-written and correct, return an empty comments array
- Each comment must reference the exact file path and line number from the diff (look for [L##] markers)
- Be specific: reference variable names, function calls, and values
- Keep each comment under 3 sentences
- Include a concrete fix suggestion when possible
- Classify each comment with a severity: "critical", "warning", or "suggestion"

## Response Format
Respond with ONLY valid JSON (no markdown fencing, no extra text):
{
  "summary": "1-3 sentence overall assessment of the PR quality",
  "comments": [
    {
      "path": "src/example.js",
      "line": 42,
      "severity": "warning",
      "body": "Concise description of the issue and suggested fix."
    }
  ]
}

If there are no issues worth commenting on, use: { "summary": "...", "comments": [] }`;
}

function parseReviewResponse(text) {
  // Strip markdown code fences if Claude wrapped the JSON
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    core.warning(`Failed to parse Claude response as JSON. Raw response:\n${text.slice(0, 500)}`);
    return {
      summary: 'Code review completed but response parsing failed. Check the action logs.',
      comments: [],
    };
  }

  // Validate structure
  const summary = typeof parsed.summary === 'string' ? parsed.summary : 'No summary provided.';
  const comments = Array.isArray(parsed.comments)
    ? parsed.comments
        .filter(c => c && typeof c.path === 'string' && typeof c.line === 'number' && typeof c.body === 'string')
        .map(c => ({
          path: c.path,
          line: c.line,
          severity: ['critical', 'warning', 'suggestion'].includes(c.severity) ? c.severity : 'suggestion',
          body: c.body,
        }))
    : [];

  return { summary, comments };
}
