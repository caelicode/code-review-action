# CaeliCode Code Review

[![CI](https://github.com/caelicode/code-review-action/actions/workflows/ci.yml/badge.svg)](https://github.com/caelicode/code-review-action/actions/workflows/ci.yml)
[![Release](https://github.com/caelicode/code-review-action/actions/workflows/release.yml/badge.svg)](https://github.com/caelicode/code-review-action/actions/workflows/release.yml)

AI-powered pull request review using Claude. Posts inline comments on bugs, security issues, and logic errors — skips the noise.

## Features

- **Signal over noise** — only flags genuine issues (bugs, security, logic errors), not style nitpicks
- **Inline comments** — posts directly on the relevant lines in your PR, with severity badges
- **Configurable focus** — choose what to review: `bugs`, `security`, `logic`, `performance`, `error-handling`
- **Severity filter** — set minimum severity (`low`, `medium`, `high`) to control comment volume
- **File filtering** — include/exclude files by glob pattern, auto-skips lockfiles and dist/
- **Cost control** — `max_files` limit prevents expensive reviews on large PRs
- **PR summary** — optional summary comment with overall assessment

## Quick Start

```yaml
name: Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: AI Code Review
        uses: caelicode/code-review-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Usage Examples

### Security-focused review

```yaml
- name: Security Review
  uses: caelicode/code-review-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    review_scope: security
    severity: high
```

### Review only backend code

```yaml
- name: Backend Review
  uses: caelicode/code-review-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    include_paths: 'src/**,lib/**'
    exclude_paths: '*.test.js,*.spec.ts,__tests__/**'
```

### Use a different Claude model

```yaml
- name: Code Review (Opus)
  uses: caelicode/code-review-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: claude-opus-4-5-20251101
    max_tokens: 8192
```

### Capture review output

```yaml
- name: Code Review
  id: review
  uses: caelicode/code-review-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Check results
  run: |
    echo "Comments: ${{ steps.review.outputs.comments_count }}"
    echo "Files: ${{ steps.review.outputs.files_reviewed }}"
    echo "Summary: ${{ steps.review.outputs.summary }}"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `anthropic_api_key` | Anthropic API key | Yes | — |
| `model` | Claude model to use | No | `claude-sonnet-4-5-20250929` |
| `max_tokens` | Max response tokens | No | `4096` |
| `review_scope` | Focus areas (comma-separated) | No | `bugs,security,logic` |
| `severity` | Minimum severity: `low`, `medium`, `high` | No | `medium` |
| `include_paths` | Glob patterns for files to review | No | all changed files |
| `exclude_paths` | Glob patterns for files to skip | No | `*.lock,*.min.js,...` |
| `max_files` | Skip if PR has more than N files (0 = no limit) | No | `20` |
| `post_summary` | Post a summary comment on the PR | No | `true` |
| `github_token` | GitHub token for posting comments | No | `${{ github.token }}` |

## Outputs

| Output | Description |
|--------|-------------|
| `comments_count` | Number of inline comments posted |
| `summary` | Review summary text |
| `files_reviewed` | Number of files reviewed |

## Comment Severity Levels

Each inline comment is prefixed with a severity badge:

| Badge | Level | When used |
|-------|-------|-----------|
| 🔴 | **Critical** | Security vulnerabilities, data loss, crashes |
| 🟡 | **Warning** | Logic errors, race conditions, edge cases |
| 🔵 | **Suggestion** | Performance improvements, better patterns |

## How It Works

1. Fetches the PR diff via GitHub API
2. Parses the unified diff into structured file/hunk objects with line number mapping
3. Filters files by include/exclude patterns and max_files limit
4. Sends the diff to Claude with a system prompt tuned for code review
5. Parses Claude's JSON response into inline comments with severity levels
6. Posts comments as a GitHub PR review (batch, with individual fallback)
7. Optionally posts a summary comment

## Requirements

- An [Anthropic API key](https://console.anthropic.com/) stored as a repository secret
- The workflow must have `pull-requests: write` permission

## License

[MIT](LICENSE)
