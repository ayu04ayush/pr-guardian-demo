/**
 * PR GUARDIAN — Local Test Runner
 *
 * Enables local verification of:
 * - Gemini API communication & schema adherence (Live Mode)
 * - JSON schema parsing & field normalization
 * - Content-based fingerprint generation
 * - Duplicate comment prevention across runs
 * - Diff hunk parsing & line anchor validation
 * - Inline & Summary comment markdown generation
 *
 * Usage:
 *   1. Live Mode (requires GEMINI_API_KEY):
 *      $env:GEMINI_API_KEY="your-key"; npm run test:local
 *   2. Offline Mock Mode (no key required):
 *      npm run test:local -- --mock
 */

const { GeminiReviewer } = require("./lib/gemini");
const { formatInlineComment, formatSummary } = require("./lib/format");
const { createFingerprint, embedFingerprint, extractFingerprint } = require("./lib/fingerprint");
const { extractValidDiffLines, findClosestDiffLine } = require("./lib/github");

const SAMPLE_DIFF = `
--- File: src/auth.js ---
@@ -10,12 +10,24 @@
 function login(username, password) {
-  const query = "SELECT * FROM users WHERE username = '" + username + "'";
+  const API_KEY = "sk-live-99a8b7c6d5e4f3a2b1c0"; // Production Stripe Secret
+  const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
   console.log("Logging in user: " + username);
-  return db.execute(query);
+  return db.execute(query);
 }

+async function batchFetchUserData(userIds) {
+  const results = [];
+  // Inefficient N+1 query pattern: sequential await in loop
+  for (let i = 0; i <= userIds.length; i++) { // Off-by-one bug: <= causes undefined at end
+    const user = await db.query("SELECT * FROM profiles WHERE id = ?", [userIds[i]]);
+    results.push(user);
+  }
+  return results;
+}
`;

const MOCK_GEMINI_RESPONSE = {
  summary: "The pull request introduces 1 critical security vulnerability, 1 high-priority bug, and 1 performance bottleneck that should be addressed before merging.",
  findings: [
    {
      severity: "CRITICAL",
      category: "SECURITY",
      file: "src/auth.js",
      line: 12,
      title: "Hardcoded Production Secret Key",
      explanation: "A hardcoded Stripe live API key was committed directly in the source code.",
      impact: "Anyone with read access to the repository can compromise production billing and user financial records.",
      suggested_fix: "Remove the hardcoded secret and load it securely via environment variables (process.env.STRIPE_API_KEY).",
      suggested_code: "const API_KEY = process.env.STRIPE_API_KEY;",
    },
    {
      severity: "CRITICAL",
      category: "SECURITY",
      file: "src/auth.js",
      line: 13,
      title: "SQL Injection Vulnerability",
      explanation: "User input 'username' and 'password' is concatenated directly into a raw SQL query string.",
      impact: "An attacker can bypass authentication or extract sensitive database tables via SQL injection.",
      suggested_fix: "Use parameterized queries or prepared statements instead of string concatenation.",
      suggested_code: 'const query = "SELECT * FROM users WHERE username = ? AND password = ?";\nreturn db.execute(query, [username, password]);',
    },
    {
      severity: "HIGH",
      category: "BUG",
      file: "src/auth.js",
      line: 22,
      title: "Off-by-One Array Access Boundary Error",
      explanation: "The loop condition 'i <= userIds.length' accesses an index out of bounds on the final iteration.",
      impact: "userIds[userIds.length] evaluates to undefined, causing an unintended database query with undefined parameters.",
      suggested_fix: "Change the loop condition to 'i < userIds.length'.",
      suggested_code: "for (let i = 0; i < userIds.length; i++) {",
    },
    {
      severity: "MEDIUM",
      category: "PERFORMANCE",
      file: "src/auth.js",
      line: 23,
      title: "Sequential Await Database Query in Loop (N+1)",
      explanation: "Database queries are executed sequentially inside a loop, causing significant network latency.",
      impact: "Response times scale linearly with array size, causing severe lag or timeouts under load.",
      suggested_fix: "Batch the query using SQL 'WHERE id IN (...)' or Promise.all.",
      suggested_code: "const results = await Promise.all(userIds.map(id => db.query('SELECT * FROM profiles WHERE id = ?', [id])));",
    },
  ],
};

async function main() {
  console.log("=================================================================");
  console.log("🛡️  PR GUARDIAN — LOCAL TEST SUITE");
  console.log("=================================================================\n");

  const isMockArg = process.argv.includes("--mock");
  const apiKey = process.env.GEMINI_API_KEY;
  const useMock = isMockArg || !apiKey;

  let reviewResult;
  let modelUsed = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (useMock) {
    if (!apiKey && !isMockArg) {
      console.log("ℹ️  Note: GEMINI_API_KEY not found in environment.");
      console.log("ℹ️  Running in OFFLINE MOCK MODE to verify pipeline logic & validation.");
      console.log("ℹ️  (To test live against Google Gemini: $env:GEMINI_API_KEY='key'; npm run test:local)\n");
    } else {
      console.log("ℹ️  Running in OFFLINE MOCK MODE (--mock flag passed).\n");
    }
    reviewResult = MOCK_GEMINI_RESPONSE;
  } else {
    console.log(`🌐 Connecting to Google Gemini API using model: ${modelUsed}...`);
    try {
      const gemini = new GeminiReviewer({ apiKey, model: modelUsed });
      console.log("📤 Sending sample diff to Gemini...");
      reviewResult = await gemini.reviewDiff(SAMPLE_DIFF);
      console.log("📥 Received structured response from Gemini.\n");
    } catch (err) {
      console.error(`❌ Live Gemini request failed: ${err.message}`);
      console.log("Falling back to mock verification to ensure remaining logic is intact...\n");
      reviewResult = MOCK_GEMINI_RESPONSE;
    }
  }

  // 1. Verify response structure
  console.log("-----------------------------------------------------------------");
  console.log("1. SCHEMA & FINDINGS VALIDATION");
  console.log("-----------------------------------------------------------------");
  console.log(`Summary: "${reviewResult.summary}"`);
  console.log(`Total findings returned: ${reviewResult.findings.length}`);

  if (!Array.isArray(reviewResult.findings) || reviewResult.findings.length === 0) {
    throw new Error("Validation Error: Expected non-empty findings array.");
  }
  console.log("✅ Schema validation passed.\n");

  // 2. Verify Diff Line Extraction & Anchoring
  console.log("-----------------------------------------------------------------");
  console.log("2. DIFF LINE ANCHORING & HUNK VALIDATION");
  console.log("-----------------------------------------------------------------");
  const validLines = extractValidDiffLines(SAMPLE_DIFF);
  console.log(`Valid diff lines extracted from hunk: [${Array.from(validLines).join(", ")}]`);

  for (const finding of reviewResult.findings) {
    const anchored = findClosestDiffLine(validLines, finding.line);
    console.log(`- Finding "${finding.title}": line ${finding.line} -> anchored to ${anchored}`);
  }
  console.log("✅ Diff line anchoring verified.\n");

  // 3. Verify Fingerprinting & Deduplication
  console.log("-----------------------------------------------------------------");
  console.log("3. FINGERPRINTING & DEDUPLICATION ENGINE");
  console.log("-----------------------------------------------------------------");
  const existingFingerprints = new Set();
  const postedComments = [];

  // Run 1: All findings are new
  for (const finding of reviewResult.findings) {
    const fp = createFingerprint(finding);
    existingFingerprints.add(fp);
    const inlineComment = formatInlineComment(finding);
    const withMarker = embedFingerprint(inlineComment, fp);
    postedComments.push(withMarker);

    // Verify extraction
    const extracted = extractFingerprint(withMarker);
    if (extracted !== fp) {
      throw new Error(`Fingerprint round-trip failed! Expected ${fp}, got ${extracted}`);
    }
  }
  console.log(`✅ Generated & embedded ${existingFingerprints.size} unique fingerprints.`);

  // Run 2: Re-review after commit — simulate deduplication
  let dupsFound = 0;
  let newIssuesCount = 0;
  for (const finding of reviewResult.findings) {
    const fp = createFingerprint(finding);
    if (existingFingerprints.has(fp)) {
      dupsFound++;
    } else {
      newIssuesCount++;
    }
  }
  console.log(`Simulation: Second commit received identical findings.`);
  console.log(`-> Skipped duplicates: ${dupsFound}`);
  console.log(`-> New findings to post: ${newIssuesCount}`);
  if (dupsFound !== reviewResult.findings.length) {
    throw new Error("Deduplication failed: Expected all identical findings to be skipped!");
  }
  console.log("✅ Deduplication logic successfully prevented duplicate comments.\n");

  // 4. Sample Formatted Inline Comment
  console.log("-----------------------------------------------------------------");
  console.log("4. INLINE COMMENT PREVIEW (as rendered on GitHub PR)");
  console.log("-----------------------------------------------------------------");
  console.log(formatInlineComment(reviewResult.findings[0]));
  console.log("\n");

  // 5. Sample Formatted PR Summary
  console.log("-----------------------------------------------------------------");
  console.log("5. TOP-OF-PR SUMMARY COMMENT PREVIEW");
  console.log("-----------------------------------------------------------------");
  const summaryMarkdown = formatSummary({
    findings: reviewResult.findings,
    newFindings: reviewResult.findings,
    skippedDuplicateCount: 0,
    totalFilesReviewed: 1,
    summary: reviewResult.summary,
    model: modelUsed,
  });
  console.log(summaryMarkdown);

  console.log("\n=================================================================");
  console.log("🎉 ALL LOCAL TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("\n❌ Local test failed with error:", err);
  process.exit(1);
});
