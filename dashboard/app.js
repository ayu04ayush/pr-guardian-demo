// PR Guardian Dashboard Application Logic

const SAMPLE_PRS = [
  {
    id: 42,
    title: "Feature: Add Stripe billing checkout & team profile lookup",
    author: "dev-alex",
    branch: "feat/billing-checkout",
    updated: "12 mins ago",
    status: "Reviewed",
    filesReviewed: 2,
    summary: "The pull request introduces 1 critical security vulnerability, 1 critical SQL injection risk, 1 high-priority bug, and 1 performance bottleneck that should be addressed before merging.",
    findings: [
      {
        severity: "CRITICAL",
        category: "SECURITY",
        file: "src/auth.js",
        line: 12,
        title: "Hardcoded Production Secret Key",
        explanation: "A live Stripe API secret key ('sk_live_51M0demo...') was committed directly to source control.",
        impact: "Anyone with read permissions to this repository can compromise company financial processing and customer billing.",
        suggested_fix: "Remove the key immediately, rotate it in the Stripe dashboard, and access it via process.env.STRIPE_SECRET_KEY.",
        suggested_code: "const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;",
      },
      {
        severity: "CRITICAL",
        category: "SECURITY",
        file: "src/auth.js",
        line: 14,
        title: "SQL Injection Vulnerability",
        explanation: "Raw user input 'username' and 'password' is concatenated directly into an unparameterized SQL query.",
        impact: "Attackers can bypass authentication completely or extract entire user tables using SQL injection payload.",
        suggested_fix: "Use parameterized queries or prepared statements.",
        suggested_code: 'const query = "SELECT * FROM users WHERE username = ? AND password_hash = ?";\nreturn db.query(query, [username, password]);',
      },
      {
        severity: "HIGH",
        category: "BUG",
        file: "src/auth.js",
        line: 23,
        title: "Off-by-One Array Access Boundary Error",
        explanation: "The loop bound uses 'i <= teamMemberIds.length' rather than '<'. On the final iteration, it accesses an out-of-bounds index.",
        impact: "teamMemberIds[teamMemberIds.length] evaluates to undefined, causing invalid database queries.",
        suggested_fix: "Change comparison to strictly less than '<'.",
        suggested_code: "for (let i = 0; i < teamMemberIds.length; i++) {",
      },
      {
        severity: "MEDIUM",
        category: "PERFORMANCE",
        file: "src/auth.js",
        line: 24,
        title: "Sequential Await Database Query in Loop (N+1)",
        explanation: "Executing single database queries sequentially inside an unbounded loop introduces high latency overhead.",
        impact: "Response times scale linearly with array length, risking API timeouts for large teams.",
        suggested_fix: "Batch query using SQL 'WHERE id IN (?)' or execute parallel queries with Promise.all.",
        suggested_code: "const profiles = await db.query('SELECT * FROM profiles WHERE id IN (?)', [teamMemberIds]);",
      },
    ],
  },
  {
    id: 43,
    title: "Fix: Parameterize SQL queries & load Stripe secrets via env",
    author: "dev-alex",
    branch: "fix/stripe-credentials",
    updated: "3 mins ago",
    status: "Passed",
    filesReviewed: 1,
    summary: "All previously reported critical security vulnerabilities and bugs have been resolved. Code conforms to security and reliability standards.",
    findings: [],
  },
  {
    id: 44,
    title: "Refactor: In-memory cache for user permission checks",
    author: "sarah-eng",
    branch: "perf/cache-permissions",
    updated: "1 hour ago",
    status: "Reviewed",
    filesReviewed: 3,
    summary: "The pull request implements caching cleanly, but introduces an unbounded Map that could cause memory leak issues under high traffic.",
    findings: [
      {
        severity: "MEDIUM",
        category: "PERFORMANCE",
        file: "src/cache/permissionCache.js",
        line: 35,
        title: "Unbounded In-Memory Cache Growth",
        explanation: "The cache Map has no maximum size limit or TTL eviction policy.",
        impact: "Under prolonged service runtime, memory usage will grow monotonically leading to OOM process termination.",
        suggested_fix: "Use an LRU cache or set a strict maximum size with eviction.",
        suggested_code: "const lruCache = new QuickLRU({ maxSize: 10000 });",
      },
    ],
  },
];

const PRESET_DIFFS = {
  vulnerable: `--- a/src/auth.js
+++ b/src/auth.js
@@ -10,14 +10,24 @@
 function login(username, password) {
+  const API_KEY = "sk-live-99a8b7c6d5e4f3a2b1c0";
+  const query = "SELECT * FROM users WHERE username = '" + username + "'";
   return db.execute(query);
 }
+
+async function fetchTeamProfiles(userIds) {
+  const results = [];
+  for (let i = 0; i <= userIds.length; i++) {
+    const user = await db.query("SELECT * FROM profiles WHERE id = ?", [userIds[i]]);
+    results.push(user);
+  }
+  return results;
+}`,
  boundary: `--- a/src/utils/batch.js
+++ b/src/utils/batch.js
@@ -4,6 +4,12 @@
 function processBatches(items) {
+  for (let i = 0; i <= items.length; i++) {
+    items[i].process(); // Uncaught null/undefined reference at end
+  }
+}`,
  clean: `--- a/src/auth.js
+++ b/src/auth.js
@@ -10,8 +10,8 @@
 function login(username, password) {
-  const query = "SELECT * FROM users WHERE username = '" + username + "'";
+  const query = "SELECT * FROM users WHERE username = ? AND password = ?";
+  return db.execute(query, [username, password]);
 }`,
};

function initDashboard() {
  renderPRList();
  selectPR(SAMPLE_PRS[0].id);
  setupTabs();
  setupSandbox();
}

function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId).classList.add("active");
    });
  });
}

function renderPRList() {
  const listEl = document.getElementById("pr-list");
  listEl.innerHTML = "";

  SAMPLE_PRS.forEach((pr) => {
    const item = document.createElement("div");
    item.className = "pr-item";
    item.id = `pr-item-${pr.id}`;
    item.addEventListener("click", () => selectPR(pr.id));

    const critCount = pr.findings.filter((f) => f.severity === "CRITICAL").length;
    const highCount = pr.findings.filter((f) => f.severity === "HIGH").length;

    let badgeHtml = "";
    if (pr.findings.length === 0) {
      badgeHtml = '<span class="badge" style="background: rgba(63,185,80,0.15); color: var(--accent-green); border: 1px solid rgba(63,185,80,0.3);">✅ Clean</span>';
    } else {
      if (critCount > 0) badgeHtml += `<span class="badge badge-critical">🔴 ${critCount} Crit</span>`;
      if (highCount > 0) badgeHtml += `<span class="badge badge-high">🟠 ${highCount} High</span>`;
    }

    item.innerHTML = `
      <div class="pr-info">
        <div class="pr-title">#${pr.id} — ${pr.title}</div>
        <div class="pr-meta">
          <span>👤 ${pr.author}</span>
          <span>🌿 ${pr.branch}</span>
          <span>⏱️ ${pr.updated}</span>
        </div>
      </div>
      <div class="pr-badges">${badgeHtml}</div>
    `;

    listEl.appendChild(item);
  });
}

function selectPR(id) {
  document.querySelectorAll(".pr-item").forEach((el) => el.classList.remove("active"));
  const activeEl = document.getElementById(`pr-item-${id}`);
  if (activeEl) activeEl.classList.add("active");

  const pr = SAMPLE_PRS.find((p) => p.id === id);
  if (!pr) return;

  document.getElementById("selected-pr-title").innerText = `PR #${pr.id} — ${pr.title}`;
  document.getElementById("selected-pr-status").innerText = `Status: ${pr.status}`;

  // Render simulated Top-of-PR Summary Comment
  const summaryBox = document.getElementById("pr-summary-box");
  const crit = pr.findings.filter((f) => f.severity === "CRITICAL").length;
  const high = pr.findings.filter((f) => f.severity === "HIGH").length;
  const med = pr.findings.filter((f) => f.severity === "MEDIUM").length;
  const low = pr.findings.filter((f) => f.severity === "LOW").length;

  const bugs = pr.findings.filter((f) => f.category === "BUG").length;
  const sec = pr.findings.filter((f) => f.category === "SECURITY").length;
  const perf = pr.findings.filter((f) => f.category === "PERFORMANCE").length;
  const qlty = pr.findings.filter((f) => f.category === "QUALITY").length;

  summaryBox.innerHTML = `
    <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 14px;">
      <div style="font-weight: 700; color: var(--text-bright); margin-bottom: 6px;">🤖 PR GUARDIAN — AI CODE REVIEW</div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Files reviewed: <strong>${pr.filesReviewed}</strong></div>
      
      <div style="display: flex; gap: 12px; margin-bottom: 8px; font-size: 12px; flex-wrap: wrap;">
        <span>🔴 <strong>Critical:</strong> ${crit}</span>
        <span>🟠 <strong>High:</strong> ${high}</span>
        <span>🟡 <strong>Medium:</strong> ${med}</span>
        <span>🔵 <strong>Low:</strong> ${low}</span>
      </div>

      <div style="display: flex; gap: 12px; margin-bottom: 12px; font-size: 12px; flex-wrap: wrap;">
        <span>🐛 <strong>Bugs:</strong> ${bugs}</span>
        <span>🔐 <strong>Security:</strong> ${sec}</span>
        <span>⚡ <strong>Performance:</strong> ${perf}</span>
        <span>🧹 <strong>Quality:</strong> ${qlty}</span>
      </div>

      <div style="font-size: 13px; color: var(--text-primary); border-top: 1px solid var(--border-color); padding-top: 8px;">
        <strong>Summary:</strong> ${pr.summary}
      </div>
    </div>
  `;

  // Render Findings
  const findingsList = document.getElementById("pr-findings-list");
  findingsList.innerHTML = "";

  if (pr.findings.length === 0) {
    findingsList.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--accent-green); background: rgba(63,185,80,0.05); border: 1px solid rgba(63,185,80,0.2); border-radius: 6px;">
        ✅ <strong>No active issues found in this pull request!</strong><br>
        <span style="font-size: 12px; color: var(--text-secondary);">All previously flagged issues were remediated.</span>
      </div>
    `;
    return;
  }

  pr.findings.forEach((f) => {
    const box = document.createElement("div");
    box.className = "finding-box";

    let sevBadge = "badge-medium";
    let sevIcon = "🟡";
    if (f.severity === "CRITICAL") { sevBadge = "badge-critical"; sevIcon = "🔴"; }
    else if (f.severity === "HIGH") { sevBadge = "badge-high"; sevIcon = "🟠"; }
    else if (f.severity === "LOW") { sevBadge = "badge-low"; sevIcon = "🔵"; }

    let catIcon = "🔍";
    if (f.category === "BUG") catIcon = "🐛";
    else if (f.category === "SECURITY") catIcon = "🔐";
    else if (f.category === "PERFORMANCE") catIcon = "⚡";
    else if (f.category === "QUALITY") catIcon = "🧹";

    box.innerHTML = `
      <div class="finding-title-row">
        <div>
          <span class="badge ${sevBadge}">${sevIcon} ${f.severity}</span>
          <span class="badge badge-category">${catIcon} ${f.category}</span>
          <strong style="margin-left: 6px; color: var(--text-bright);">${f.title}</strong>
        </div>
        <span class="finding-loc">${f.file}:${f.line}</span>
      </div>
      <div class="finding-desc">${f.explanation}</div>
      <div class="finding-impact"><strong>Why this matters / Impact:</strong> ${f.impact}</div>
      <div class="finding-fix"><strong>Suggested Fix:</strong> ${f.suggested_fix}</div>
      ${f.suggested_code ? `<pre class="code-block">${escapeHtml(f.suggested_code)}</pre>` : ""}
    `;

    findingsList.appendChild(box);
  });
}

function setupSandbox() {
  const select = document.getElementById("sample-select");
  const textarea = document.getElementById("sandbox-diff-input");
  const runBtn = document.getElementById("btn-run-sim");
  const outputEl = document.getElementById("sandbox-output");
  const statusEl = document.getElementById("sim-status");

  textarea.value = PRESET_DIFFS.vulnerable;

  select.addEventListener("change", () => {
    textarea.value = PRESET_DIFFS[select.value] || "";
  });

  runBtn.addEventListener("click", () => {
    statusEl.innerText = "Analyzing...";
    statusEl.style.color = "var(--accent-orange)";

    setTimeout(() => {
      statusEl.innerText = "Review Complete";
      statusEl.style.color = "var(--accent-green)";

      const diff = textarea.value;
      const findings = [];

      if (diff.includes("sk-live-") || diff.includes("sk_live_")) {
        findings.push({
          severity: "CRITICAL",
          category: "SECURITY",
          file: "src/auth.js",
          line: 12,
          title: "Hardcoded Stripe Production Secret Key",
          explanation: "Live secret token committed directly in repository patch.",
          impact: "Credential leakage allows unauthorized billing actions.",
          suggested_fix: "Use environment variables.",
          suggested_code: "const API_KEY = process.env.STRIPE_API_KEY;",
        });
      }

      if (diff.includes("SELECT * FROM users WHERE username = '")) {
        findings.push({
          severity: "CRITICAL",
          category: "SECURITY",
          file: "src/auth.js",
          line: 13,
          title: "SQL Injection via String Concatenation",
          explanation: "User input directly interpolated into SQL query string.",
          impact: "Bypasses authentication and compromises user table.",
          suggested_fix: "Use parameterized queries.",
          suggested_code: 'const query = "SELECT * FROM users WHERE username = ? AND password = ?";',
        });
      }

      if (diff.includes("<= userIds.length") || diff.includes("<= items.length")) {
        findings.push({
          severity: "HIGH",
          category: "BUG",
          file: "src/auth.js",
          line: 19,
          title: "Off-by-One Array Index Bound",
          explanation: "Comparison '<=' reads undefined index on final loop iteration.",
          impact: "Causes runtime exception or queries with undefined parameters.",
          suggested_fix: "Change to strictly less than '<'.",
          suggested_code: "for (let i = 0; i < userIds.length; i++) {",
        });
      }

      let html = `
        <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 14px; margin-bottom: 14px;">
          <h4 style="color: var(--text-bright); margin-bottom: 6px;">🤖 Generated PR Summary Comment</h4>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">
            Files reviewed: 1 &nbsp;|&nbsp; 🔴 Critical: ${findings.filter(f => f.severity === 'CRITICAL').length} &nbsp;|&nbsp; 🟠 High: ${findings.filter(f => f.severity === 'HIGH').length}
          </p>
          <p style="font-size: 13px; color: var(--text-primary);">
            ${findings.length > 0 ? `The PR contains ${findings.length} actionable issue(s) that should be reviewed before merging.` : "✅ All checks passed! No issues detected."}
          </p>
        </div>
      `;

      if (findings.length === 0) {
        html += `<div style="color: var(--accent-green); padding: 14px; background: rgba(63,185,80,0.1); border-radius: 6px;">✅ Diff is clean! No bugs or security issues detected.</div>`;
      } else {
        html += `<h4 style="color: var(--text-bright); margin-bottom: 10px;">Generated Inline Annotations (${findings.length})</h4>`;
        findings.forEach((f) => {
          html += `
            <div class="finding-box">
              <div class="finding-title-row">
                <span><strong style="color: var(--accent-red);">${f.severity}</strong> &middot; ${f.category} &middot; <strong>${f.title}</strong></span>
                <span class="finding-loc">${f.file}:${f.line}</span>
              </div>
              <div class="finding-desc">${f.explanation}</div>
              <div class="finding-fix"><strong>Fix:</strong> ${f.suggested_fix}</div>
              ${f.suggested_code ? `<pre class="code-block">${escapeHtml(f.suggested_code)}</pre>` : ""}
            </div>
          `;
        });
      }

      outputEl.innerHTML = html;
    }, 400);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", initDashboard);
