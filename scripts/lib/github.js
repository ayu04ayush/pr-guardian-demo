const { Octokit } = require("@octokit/rest");
const { extractFingerprint } = require("./fingerprint");

const SUMMARY_MARKER = "<!-- pr-guardian-summary -->";
const LEGACY_SUMMARY_MARKER = "<!-- ai-review-summary -->";

// File patterns that should NOT be reviewed by AI
const IGNORED_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lockb$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.(png|jpg|jpeg|gif|svg|ico|webp|avif)$/i,
  /\.(mp4|webm|mov|mp3|wav)$/i,
  /\.(pdf|zip|tar|gz|rar|7z|exe|dll|so|dylib)$/i,
  /\.(woff|woff2|ttf|eot|otf)$/i,
  /\.git/i,
  /node_modules/i,
  /dist\//i,
  /build\//i,
];

/**
 * Parses a unified diff patch to extract all valid line numbers on the new ('+') side.
 * GitHub requires inline review comments to be anchored strictly to lines included in diff hunks.
 *
 * @param {string} patch
 * @returns {Set<number>} Set of valid line numbers
 */
function extractValidDiffLines(patch) {
  const validLines = new Set();
  if (!patch || typeof patch !== "string") return validLines;

  const lines = patch.split("\n");
  let currentNewLine = 0;
  let inHunk = false;

  for (const line of lines) {
    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1], 10);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+")) {
      validLines.add(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith(" ")) {
      // Context lines inside the hunk are also valid anchor targets in GitHub diffs
      validLines.add(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith("-")) {
      // Deleted line, does not increment new file line counter
    }
  }

  return validLines;
}

/**
 * Finds the closest valid line in the diff hunk for a given target line.
 *
 * @param {Set<number>} validLines
 * @param {number} targetLine
 * @returns {number|null}
 */
function findClosestDiffLine(validLines, targetLine) {
  if (!validLines || validLines.size === 0) return null;
  if (validLines.has(targetLine)) return targetLine;

  let closest = null;
  let minDiff = Infinity;

  for (const line of validLines) {
    const diff = Math.abs(line - targetLine);
    if (diff < minDiff) {
      minDiff = diff;
      closest = line;
    }
  }

  return closest;
}

class GitHubClient {
  constructor({ token, owner, repo, pullNumber }) {
    if (!token) {
      throw new Error("GITHUB_TOKEN is required to initialize GitHubClient.");
    }
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
    this.pullNumber = pullNumber;
  }

  /**
   * Fetches changed files for the PR, filtering out binary, generated, and deleted files.
   * Returns files with their patch and valid diff lines.
   */
  async getChangedFiles() {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      per_page: 100,
    });

    const reviewableFiles = [];

    for (const f of files) {
      // Skip deleted files (status === 'removed') as there is no new code to review
      if (f.status === "removed") continue;

      // Skip files without a patch
      if (!f.patch) continue;

      // Skip ignored extensions / paths
      if (IGNORED_PATTERNS.some((pattern) => pattern.test(f.filename))) {
        continue;
      }

      const validLines = extractValidDiffLines(f.patch);

      reviewableFiles.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        validLines,
      });
    }

    return reviewableFiles;
  }

  /**
   * Retrieves the HEAD commit SHA of the Pull Request.
   */
  async getHeadCommitSha() {
    const { data } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
    });
    return data.head.sha;
  }

  /**
   * Retrieves all existing fingerprints from previously posted comments on this PR.
   */
  async getExistingFingerprints() {
    const fingerprints = new Set();

    try {
      // 1. Check PR inline review comments
      const reviewComments = await this.octokit.paginate(
        this.octokit.pulls.listReviewComments,
        {
          owner: this.owner,
          repo: this.repo,
          pull_number: this.pullNumber,
          per_page: 100,
        }
      );

      for (const c of reviewComments) {
        const fp = extractFingerprint(c.body || "");
        if (fp) fingerprints.add(fp);
      }

      // 2. Also check top-level issue comments (fallback comments)
      const issueComments = await this.octokit.paginate(
        this.octokit.issues.listComments,
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: this.pullNumber,
          per_page: 100,
        }
      );

      for (const c of issueComments) {
        const fp = extractFingerprint(c.body || "");
        if (fp) fingerprints.add(fp);
      }
    } catch (err) {
      console.warn(`[GitHubClient] Warning while fetching existing fingerprints: ${err.message}`);
    }

    return fingerprints;
  }

  /**
   * Posts inline review comments anchored to the diff.
   * If batch creation fails (e.g. 422 on line mismatch), gracefully tries individual comments or fallback.
   */
  async postInlineReview({ commitId, comments, reviewBody = "" }) {
    if (!comments || comments.length === 0) return;

    try {
      // Attempt batch review creation first
      await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.pullNumber,
        commit_id: commitId,
        event: "COMMENT",
        body: reviewBody,
        comments,
      });
      console.log(`[GitHubClient] Successfully posted batch review with ${comments.length} inline comment(s).`);
      return;
    } catch (err) {
      console.warn(
        `[GitHubClient] Batch createReview failed (${err.message}). Attempting individual comment posting...`
      );
    }

    // Fallback: try posting each review comment individually
    const failedComments = [];
    let successCount = 0;

    for (const c of comments) {
      try {
        await this.octokit.pulls.createReviewComment({
          owner: this.owner,
          repo: this.repo,
          pull_number: this.pullNumber,
          commit_id: commitId,
          path: c.path,
          line: c.line,
          side: "RIGHT",
          body: c.body,
        });
        successCount++;
      } catch (indErr) {
        console.warn(`[GitHubClient] Could not post inline comment at ${c.path}:${c.line} (${indErr.message})`);
        failedComments.push(c);
      }
    }

    console.log(`[GitHubClient] Posted ${successCount} individual inline comment(s).`);

    // If any comments still failed (e.g. line outside diff), post them as an issue comment so they are never lost
    if (failedComments.length > 0) {
      console.warn(`[GitHubClient] Posting ${failedComments.length} unanchored finding(s) as a PR comment.`);
      const fallbackBody = failedComments
        .map((c) => `**Location:** \`${c.path}:${c.line}\`\n\n${c.body}`)
        .join("\n\n---\n\n");

      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.pullNumber,
        body: `### 🤖 PR Guardian — Additional Findings\n\n${fallbackBody}`,
      });
    }
  }

  /**
   * Upserts the single running summary comment on the Pull Request.
   * If a previous summary comment exists, it edits it; otherwise it creates a new one.
   */
  async upsertSummaryComment(body) {
    const fullBody = `${SUMMARY_MARKER}\n${body}`;

    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      owner: this.owner,
      repo: this.repo,
      issue_number: this.pullNumber,
      per_page: 100,
    });

    const previous = comments.find(
      (c) =>
        c.body &&
        (c.body.includes(SUMMARY_MARKER) || c.body.includes(LEGACY_SUMMARY_MARKER))
    );

    if (previous) {
      await this.octokit.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: previous.id,
        body: fullBody,
      });
      console.log(`[GitHubClient] Updated existing summary comment (ID: ${previous.id}).`);
    } else {
      const created = await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.pullNumber,
        body: fullBody,
      });
      console.log(`[GitHubClient] Created new summary comment (ID: ${created.data.id}).`);
    }
  }
}

module.exports = {
  GitHubClient,
  extractValidDiffLines,
  findClosestDiffLine,
  IGNORED_PATTERNS,
  SUMMARY_MARKER,
};
