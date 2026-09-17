/**
 * PR GUARDIAN — Automated AI Code Reviewer
 *
 * Core Orchestrator Flow:
 * 1. Read configuration and secrets securely from environment variables.
 * 2. Fetch changed files & diffs from GitHub (diff only, never full repo).
 * 3. Send diff to Google Gemini with strict schema enforcement.
 * 4. Cross-reference diff hunks to ensure all line numbers are valid anchors.
 * 5. Deduplicate against previously posted findings using content fingerprints.
 * 6. Post new findings as inline comments on the PR diff.
 * 7. Upsert a single, persistent summary comment at the top of the PR.
 *
 * Security Note:
 * Secrets (GEMINI_API_KEY, GITHUB_TOKEN) are injected at runtime by GitHub Actions.
 * They are NEVER hardcoded, logged, written to disk, or transmitted to untrusted destinations.
 */

const { GitHubClient, findClosestDiffLine } = require("./lib/github");
const { GeminiReviewer } = require("./lib/gemini");
const { createFingerprint, embedFingerprint } = require("./lib/fingerprint");
const { formatInlineComment, formatSummary } = require("./lib/format");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || "80000", 10);
const MAX_FILE_PATCH_CHARS = 25000;

async function main() {
  console.log("==================================================");
  console.log("🛡️  PR GUARDIAN — Starting AI Pull Request Review");
  console.log("==================================================");

  // 1. Load config & secrets securely from environment
  const githubToken = requireEnv("GITHUB_TOKEN");
  const geminiApiKey = requireEnv("GEMINI_API_KEY");
  const owner = requireEnv("REPO_OWNER");
  const repo = requireEnv("REPO_NAME");
  const pullNumber = parseInt(requireEnv("PR_NUMBER"), 10);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  console.log(`[PR Guardian] Reviewing PR #${pullNumber} in ${owner}/${repo}`);
  console.log(`[PR Guardian] AI Provider: Google Gemini (${model})`);

  const github = new GitHubClient({ token: githubToken, owner, repo, pullNumber });
  const gemini = new GeminiReviewer({ apiKey: geminiApiKey, model });

  // 2. Fetch only reviewable changed files/diff
  console.log("[PR Guardian] Fetching PR diff from GitHub...");
  const changedFiles = await github.getChangedFiles();
  console.log(`[PR Guardian] Found ${changedFiles.length} reviewable file(s).`);

  if (changedFiles.length === 0) {
    console.log("[PR Guardian] No reviewable code changes in this PR. Updating summary and exiting.");
    await github.upsertSummaryComment(
      formatSummary({
        findings: [],
        newFindings: [],
        skippedDuplicateCount: 0,
        totalFilesReviewed: 0,
        summary: "No reviewable code changes detected (only binary, lockfiles, or ignored files changed).",
        model,
      })
    );
    return;
  }

  // 3. Assemble diff safely with size guardrails
  let diffText = "";
  const fileMap = new Map();

  for (const f of changedFiles) {
    fileMap.set(f.filename, f);

    let patchContent = f.patch;
    if (patchContent.length > MAX_FILE_PATCH_CHARS) {
      patchContent = patchContent.slice(0, MAX_FILE_PATCH_CHARS) + "\n... [Diff truncated due to size]";
    }

    const chunk = `\n--- File: ${f.filename} ---\n${patchContent}\n`;
    if (diffText.length + chunk.length > MAX_DIFF_CHARS) {
      diffText += `\n[Remaining files truncated to maintain safe diff review limits]`;
      console.warn(`[PR Guardian] Diff exceeded ${MAX_DIFF_CHARS} chars limit; chunked for safe review.`);
      break;
    }
    diffText += chunk;
  }

  // 4. Send diff to Gemini for analysis
  console.log(`[PR Guardian] Sending diff (${diffText.length} chars) to Gemini...`);
  let reviewResult;
  try {
    reviewResult = await gemini.reviewDiff(diffText);
  } catch (err) {
    console.error(`[PR Guardian] ❌ Gemini analysis failed: ${err.message}`);
    await github.upsertSummaryComment(
      `## 🤖 PR GUARDIAN — AI CODE REVIEW\n\n⚠️ **Review Incomplete:** PR Guardian could not complete the review due to an AI service error: \`${err.message}\`\n\n*Check GitHub Action logs for details.*`
    );
    process.exitCode = 1;
    return;
  }

  const { summary: aiSummary, findings } = reviewResult;
  console.log(`[PR Guardian] Gemini identified ${findings.length} total finding(s).`);

  // 5. Deduplicate findings against previous reviews on this PR
  console.log("[PR Guardian] Checking existing comments to avoid duplicate spam...");
  const existingFingerprints = await github.getExistingFingerprints();
  const newFindings = [];
  let skippedDuplicateCount = 0;

  for (const finding of findings) {
    const fingerprint = createFingerprint(finding);

    if (existingFingerprints.has(fingerprint)) {
      skippedDuplicateCount++;
      continue;
    }

    // Anchor line to valid diff line range if possible
    const fileObj = fileMap.get(finding.file);
    let targetLine = finding.line;
    if (fileObj && fileObj.validLines && fileObj.validLines.size > 0) {
      const closest = findClosestDiffLine(fileObj.validLines, finding.line);
      if (closest !== null) {
        targetLine = closest;
      }
    }

    newFindings.push({
      ...finding,
      line: targetLine,
      _fingerprint: fingerprint,
    });
  }

  console.log(
    `[PR Guardian] New findings to post: ${newFindings.length}, Duplicates skipped: ${skippedDuplicateCount}.`
  );

  // 6. Post new findings as inline comments on the PR diff
  if (newFindings.length > 0) {
    const commitId = await github.getHeadCommitSha();
    const inlineComments = newFindings.map((f) => ({
      path: f.file,
      line: f.line,
      body: embedFingerprint(formatInlineComment(f), f._fingerprint),
    }));

    console.log(`[PR Guardian] Posting ${inlineComments.length} inline review comment(s)...`);
    await github.postInlineReview({
      commitId,
      comments: inlineComments,
      reviewBody: `🛡️ **PR Guardian** found ${newFindings.length} issue(s) requiring attention in this commit. See inline annotations below.`,
    });
  }

  // 7. Upsert the single persistent summary comment
  console.log("[PR Guardian] Updating top-of-PR summary comment...");
  await github.upsertSummaryComment(
    formatSummary({
      findings,
      newFindings,
      skippedDuplicateCount,
      totalFilesReviewed: changedFiles.length,
      summary: aiSummary,
      model,
    })
  );

  console.log("==================================================");
  console.log("✅  PR GUARDIAN — Review completed successfully!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("[PR Guardian] Fatal uncaught error:", err);
  process.exit(1);
});
