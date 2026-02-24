/**
 * Parse a unified diff string into structured file objects.
 *
 * Each file object has:
 *   { path, hunks: [{ header, oldStart, oldCount, newStart, newCount, lines }] }
 *
 * Each line in a hunk has:
 *   { type: '+' | '-' | ' ', content, newLineNumber, oldLineNumber }
 */

/**
 * @param {string} diffText — raw unified diff from GitHub API
 * @returns {{ path: string, hunks: object[] }[]}
 */
export function parseDiff(diffText) {
  const files = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const file = parseFileSection(section);
    if (file) files.push(file);
  }

  return files;
}

function parseFileSection(section) {
  const lines = section.split('\n');

  // Extract file path from "a/path b/path" or "+++ b/path"
  let path = null;

  for (const line of lines) {
    // Prefer the +++ line as it shows the destination path
    if (line.startsWith('+++ b/')) {
      path = line.slice(6);
      break;
    }
    if (line.startsWith('+++ /dev/null')) {
      // File was deleted — skip it
      return null;
    }
  }

  // Fallback: parse from the diff header
  if (!path) {
    const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+?)$/);
    if (headerMatch) path = headerMatch[2];
  }

  if (!path) return null;

  // Check if this is a binary file
  if (section.includes('Binary files ')) return null;

  // Parse hunks
  const hunks = [];
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkHeader) {
      currentHunk = {
        header: line,
        oldStart: parseInt(hunkHeader[1], 10),
        oldCount: parseInt(hunkHeader[2] ?? '1', 10),
        newStart: parseInt(hunkHeader[3], 10),
        newCount: parseInt(hunkHeader[4] ?? '1', 10),
        lines: [],
      };
      hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: '+',
        content: line.slice(1),
        newLineNumber: newLine,
        oldLineNumber: null,
      });
      newLine++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: '-',
        content: line.slice(1),
        newLineNumber: null,
        oldLineNumber: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: ' ',
        content: line.slice(1),
        newLineNumber: newLine,
        oldLineNumber: oldLine,
      });
      oldLine++;
      newLine++;
    }
    // Ignore "\ No newline at end of file" and other non-diff lines
  }

  if (hunks.length === 0) return null;

  return { path, hunks };
}

/**
 * Check if a file path matches any of the given glob patterns.
 * Simple glob matching: supports * and ** patterns.
 */
export function matchesGlob(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;

    // Convert glob to regex
    const regex = globToRegex(trimmed);
    if (regex.test(filePath)) return true;
  }

  return false;
}

function globToRegex(glob) {
  let regex = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex specials (except * and ?)
    .replace(/\*\*/g, '{{DOUBLESTAR}}')     // Placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/\?/g, '[^/]')                 // ? matches single char
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');  // ** matches everything

  return new RegExp(`^${regex}$`);
}

/**
 * Format parsed files into a diff string suitable for the Claude prompt.
 * Includes line numbers for accurate comment placement.
 */
export function formatDiffForPrompt(files) {
  const parts = [];

  for (const file of files) {
    parts.push(`\n### File: ${file.path}`);

    for (const hunk of file.hunks) {
      parts.push(hunk.header);

      for (const line of hunk.lines) {
        const prefix = line.type === '+' ? '+' : line.type === '-' ? '-' : ' ';
        const lineNum = line.newLineNumber ?? line.oldLineNumber ?? '?';
        parts.push(`${prefix} [L${lineNum}] ${line.content}`);
      }
    }
  }

  return parts.join('\n');
}
