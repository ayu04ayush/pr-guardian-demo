# 🛡️ PR GUARDIAN

> **An AI engineering teammate that automatically reviews every GitHub Pull Request.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-Automated_Review-2088FF?logo=github-actions&logoColor=white)](.github/workflows/ai-review.yml)
[![AI Engine](https://img.shields.io/badge/AI_Engine-Google_Gemini_2.5_Flash-8E75B2?logo=google&logoColor=white)](https://ai.google.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=nodedotjs&logoColor=white)](package.json)

---

## 1. What is PR Guardian?

**PR Guardian is not a chatbot. It is an autonomous AI engineering teammate that lives directly inside your GitHub Pull Request workflow.**

Whenever a developer opens or updates a Pull Request, PR Guardian automatically inspects the code diff, analyzes the changes for critical bugs, security vulnerabilities, performance bottlenecks, and quality defects using **Google Gemini**, and posts actionable inline annotations directly on the exact lines of code—accompanied by a persistent, self-updating PR summary.

---

## 2. Problem Statement

Modern engineering teams spend hours reviewing repetitive bugs, catching hardcoded secrets, spotting missing null checks, and debating unbatched database queries. 

While Large Language Models (LLMs) are great at code analysis, traditional AI chat interfaces suffer from major friction:
- Developers must manually open a browser tab, copy-paste diffs, write prompts, and manually translate AI responses back into code review comments.
- Context is lost when new commits are pushed.
- Copy-pasting internal code into public chatbots exposes sensitive intellectual property.
- Team members forget to run manual audits before merging.

**Result:** Flaws slip into production, while senior engineers spend time on low-level syntax and security auditing instead of high-level architectural design.

---

## 3. The Core Differentiation: Teammate vs. Chatbot

> ⚠️ **Key Differentiation:** Anyone can ask ChatGPT, Claude, or Gemini to find bugs by copying code into a web prompt. **PR Guardian eliminates the human intermediary completely.**

```
❌ TRADITIONAL MANUAL AI CHATBOT WORKFLOW:
Developer pushes code ➡️ Opens browser ➡️ Copies diff ➡️ Pastes into Chatbot ➡️ 
Writes custom prompt ➡️ Reads response ➡️ Copies advice back to GitHub PR ➡️ Repeats on every commit.

✅ PR GUARDIAN NATIVE AUTOMATED WORKFLOW:
Developer pushes code ➡️ GitHub Actions triggers ➡️ PR Guardian analyzes diff via Gemini ➡️ 
Actionable inline comments & summary posted on PR ➡️ Dev pushes fix ➡️ PR Guardian re-reviews cleanly.
```

The developer does not have to leave their terminal or IDE. PR Guardian acts like a real peer reviewer on the team.

---

## 4. Key Features

- 🎯 **Diff-Only Precision:** Only analyzes reviewable changed files (`.patch`), avoiding token waste on lockfiles, minified bundles, or untouched repository code.
- 🔴 **Actionable Severity Levels:** Categorizes findings strictly into `CRITICAL`, `HIGH`, `MEDIUM`, and `LOW`.
- 🔍 **Four Dedicated Review Pillars:**
  - **Bugs (`BUG`):** Off-by-one errors, logic flaws, null/undefined dereferences, async race conditions, edge cases.
  - **Security (`SECURITY`):** Hardcoded secrets/API keys, SQL/Command injections, unsafe deserialization, insecure inputs.
  - **Performance (`PERFORMANCE`):** Sequential loops over database/network calls (N+1 queries), unbounded memory growth, inefficient algorithms.
  - **Quality (`QUALITY`):** Fragile patterns, duplicate logic, unhandled errors, maintainability risks.
- 💬 **Precision Inline Annotations:** Automatically calculates diff line anchors on the new file (`+` side), ensuring comments anchor accurately without triggering GitHub API `422` errors.
- 📊 **Single Auto-Updating PR Summary:** Upserts a single dashboard comment at the top of the PR; edits the same comment on subsequent runs rather than spamming the PR thread.
- 🔁 **Content-Based Duplicate Prevention:** Fingerprints findings using SHA-256 (`file + category + title + explanation`). Re-pushing a commit will never re-post an existing finding.
- 🛡️ **Zero Execution Risk:** Repository code is treated strictly as untrusted text. No code is executed.
- 📊 **Local Developer Dashboard:** Standalone developer dashboard for local diff inspection, metrics, and hackathon presentation.

---

## 5. System Architecture

```
                                  GITHUB WORKFLOW
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │  Developer opens or updates Pull Request  │
                   └─────────────────────┬─────────────────────┘
                                         │
                                         ▼
                   ┌───────────────────────────────────────────┐
                   │       GitHub Actions (ai-review.yml)      │
                   │      Concurrency: Cancel stale runs       │
                   └─────────────────────┬─────────────────────┘
                                         │
                                         ▼
                   ┌───────────────────────────────────────────┐
                   │    PR Guardian Orchestrator (review.js)   │
                   │   Extracts changed files & patch hunks    │
                   └─────────────────────┬─────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
                   ▼                                           ▼
       ┌───────────────────────┐                   ┌───────────────────────┐
       │   Diff Line Parser    │                   │ Google Gemini Client  │
       │ (Hunk line validation)│                   │  (Strict JSON Schema) │
       └───────────┬───────────┘                   └───────────┬───────────┘
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         │
                                         ▼
                   ┌───────────────────────────────────────────┐
                   │   Fingerprint & Deduplication Engine      │
                   │ (SHA-256 content hash check vs PR comments)│
                   └─────────────────────┬─────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
                   ▼                                           ▼
       ┌────────────────────────┐                 ┌────────────────────────┐
       │ Inline Review Comments │                 │ Single Upserted Summary│
       │  (Exact file & line)   │                 │ (Edited on every push) │
       └────────────────────────┘                 └────────────────────────┘
```

---

## 6. Technology Stack

- **Runtime:** Node.js (v20+)
- **AI Provider:** Google Gemini API via official `@google/genai` SDK (v1.52.0)
- **GitHub Integration:** `@octokit/rest` (GitHub REST API v3)
- **CI/CD Platform:** GitHub Actions
- **Security & Hashing:** Node.js native `crypto` module (SHA-256)
- **Local Dashboard:** Native HTML5, CSS3 (GitHub Dark Mode theme), Vanilla JavaScript, Zero-dependency Node.js HTTP server

---

## 7. How Google Gemini is Used

PR Guardian communicates with Google Gemini using the official `@google/genai` SDK:

```javascript
const { GoogleGenAI, Type } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  contents: buildUserPrompt(diffText),
  config: {
    systemInstruction: SYSTEM_INSTRUCTIONS,
    temperature: 0.2, // Deterministic, sober engineering output
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA, // Strict JSON adherence
  },
});
```

### Strict JSON Output Schema
```json
{
  "summary": "Short overall review of the PR",
  "findings": [
    {
      "severity": "CRITICAL",
      "category": "SECURITY",
      "file": "src/auth.js",
      "line": 12,
      "title": "Hardcoded Production Secret Key",
      "explanation": "A live Stripe API secret key was committed directly in the source code.",
      "impact": "Anyone with read access can compromise payment processing and billing.",
      "suggested_fix": "Store key in environment variables and access via process.env.",
      "suggested_code": "const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;"
    }
  ]
}
```

---

## 8. GitHub Action Workflow

The workflow file resides in `.github/workflows/ai-review.yml` and enforces least-privilege security:

```yaml
name: PR Guardian AI Code Review

on:
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  pull-requests: write
  issues: write
  contents: read

concurrency:
  group: pr-guardian-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    name: Review PR with Gemini
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: scripts/package-lock.json

      - name: Install Review Bot Dependencies
        working-directory: ./scripts
        run: npm ci --prefer-offline --no-audit || npm install --no-audit

      - name: Run PR Guardian Review
        working-directory: ./scripts
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO_OWNER: ${{ github.repository_owner }}
          REPO_NAME: ${{ github.event.repository.name }}
          GEMINI_MODEL: ${{ vars.GEMINI_MODEL || 'gemini-2.5-flash' }}
        run: node review.js
```

---

## 9. Installation & Setup

### Step 1: Get a Google Gemini API Key
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create an API key (Gemini 2.5 Flash has a generous free tier).

### Step 2: Add Secrets to GitHub Repository
1. In your GitHub repository, go to **Settings ➡️ Secrets and variables ➡️ Actions**.
2. Click **New repository secret**.
3. Name: `GEMINI_API_KEY`
4. Value: *Paste your Google Gemini API Key*.

> 💡 **Note on `GITHUB_TOKEN`:** You do **NOT** need to generate a Personal Access Token (PAT). GitHub Actions automatically injects `GITHUB_TOKEN` at runtime with the permissions specified in the workflow.

### Step 3: Verify Workflow Permissions
1. Go to **Settings ➡️ Actions ➡️ General**.
2. Scroll to **Workflow permissions**.
3. Ensure **"Read and write permissions"** is selected.

---

## 10. Local Testing (Offline & Live)

You can test PR Guardian locally without opening an actual GitHub Pull Request.

### Option A: Offline Mock Mode (No API Key Required)
Verifies schema parsing, hunk line validation, fingerprint deduplication, and markdown generation:
```bash
# From repository root:
npm test

# Or from scripts/ directory:
cd scripts
npm run test:mock
```

### Option B: Live Gemini Test (Using your Gemini API Key)
Connects directly to Google Gemini API to analyze a test diff:

**PowerShell (Windows):**
```powershell
$env:GEMINI_API_KEY="AIzaSy..."
npm run test:local
```

**Bash (macOS / Linux):**
```bash
export GEMINI_API_KEY="AIzaSy..."
npm run test:local
```

---

## 11. Live Hackathon Demo Instructions (3 Minutes)

Follow this sequence to deliver a live demonstration for judges:

### Phase 1: The Initial Problematic PR (1.5 mins)
1. In a demo repository, create a new branch:
   ```bash
   git checkout -b feat/add-billing
   ```
2. Copy the intentionally flawed sample file into `src/auth.js`:
   ```bash
   cp fixtures/demo-vulnerable.js src/auth.js
   git add src/auth.js
   git commit -m "feat: Add billing and user lookup logic"
   git push origin feat/add-billing
   ```
3. Open a Pull Request on GitHub.
4. **Live Result:**
   - Watch GitHub Action start immediately under the **Actions** tab.
   - Within 15-20 seconds, PR Guardian completes the review.
   - Show the **Summary Comment** at the top of the PR with breakdown badges.
   - Scroll down to the diff to show **inline comments** directly flagging:
     - 🔴 `CRITICAL` Security: Hardcoded Stripe live token
     - 🔴 `CRITICAL` Security: SQL Injection vulnerability
     - 🟠 `HIGH` Bug: Off-by-one boundary loop error
     - 🟡 `MEDIUM` Performance: N+1 sequential database loop

### Phase 2: Re-Review & Duplicate Prevention (1.5 mins)
1. Replace `src/auth.js` with the remediated version:
   ```bash
   cp fixtures/demo-fixed.js src/auth.js
   git add src/auth.js
   git commit -m "fix: parameterize queries and load secrets from env"
   git push origin feat/add-billing
   ```
2. **The "Wow" Moment:**
   - The GitHub Action runs again automatically.
   - **No comment spam:** PR Guardian updates the **exact same summary comment**.
   - Resolved findings disappear from active status.
   - Already-existing comments are skipped via SHA-256 fingerprint matching.

---

## 12. Example Review Outputs

### Top-of-PR Summary Comment
```markdown
## 🤖 PR GUARDIAN — AI CODE REVIEW

**Files reviewed:** 1

### Findings:
🔴 **Critical:** 2
🟠 **High:** 1
🟡 **Medium:** 1
🔵 **Low:** 0

### Categories:
🐛 **Bugs:** 1
🔐 **Security:** 2
⚡ **Performance:** 1
🧹 **Quality:** 0

### Summary:
The pull request introduces 1 critical security vulnerability, 1 high-priority bug, and 1 performance bottleneck that should be addressed before merging.

<details>
<summary>📋 <b>Detailed Findings Breakdown (4)</b></summary>

| Severity | Category | File | Line | Issue |
|---|---|---|---|---|
| 🔴 CRITICAL | 🔐 SECURITY | `src/auth.js` | 12 | **Hardcoded Production Secret Key** |
| 🔴 CRITICAL | 🔐 SECURITY | `src/auth.js` | 13 | **SQL Injection Vulnerability** |
| 🟠 HIGH | 🐛 BUG | `src/auth.js` | 22 | **Off-by-One Array Access Boundary Error** |
| 🟡 MEDIUM | ⚡ PERFORMANCE | `src/auth.js` | 23 | **Sequential Await Database Query in Loop (N+1)** |
</details>

---
*Generated by **PR Guardian** using Google Gemini (`gemini-2.5-flash`). Updated: Thu, 17 Sep 2026 06:12:01 GMT*
```

### Inline Review Comment Example
```markdown
### 🔴 CRITICAL — 🔐 SECURITY
**Hardcoded Production Secret Key**

A hardcoded Stripe live API key was committed directly in the source code.

**Why this matters / Impact:**
Anyone with read access to the repository can compromise production billing and user financial records.

**Suggested fix:**
Remove the hardcoded secret and load it securely via environment variables (process.env.STRIPE_API_KEY).

```suggestion
const API_KEY = process.env.STRIPE_API_KEY;
```
```

---

## 13. Local Developer Dashboard

To view the dashboard locally:
```bash
npm run dashboard
```
Open **`http://localhost:3000`** in your browser to inspect:
- Total PRs reviewed & issues caught KPI metrics
- Interactive PR inspection feed
- Real-time Git Diff Sandbox (paste any diff and simulate PR Guardian)
- Interactive architecture & workflow diagram

---

## 14. Security & Safety Principles

1. **Untrusted Code Principle:** PR Guardian treats PR diffs strictly as inert text data. It never compiles, imports, evaluates (`eval`), or runs repository code.
2. **Zero Secret Leakage:** `GEMINI_API_KEY` and `GITHUB_TOKEN` are accessed via `process.env` only at runtime. They are never printed to logs or included in error traces.
3. **Least Privilege:** GitHub token permissions are explicitly restricted to `pull-requests: write`, `issues: write`, and `contents: read`.

---

## 15. Known Limitations

- **Large PR Diff Limits:** Diffs exceeding 80,000 characters are safely truncated to maintain prompt token limits and prevent API rate exhaustion.
- **Syntactic Context:** PR Guardian only inspects the unified diff hunk (`.patch`). If a bug depends on an unedited file across the repository, full whole-repo static analysis is required.

---

## 16. Future Roadmap

- [ ] **Configurable Ruleset (`.pr-guardian.yml`):** Allow teams to toggle specific categories (e.g., disable quality rules, require strict security).
- [ ] **Commit Status Checks:** Block PR merge if any unresolved `CRITICAL` findings remain.
- [ ] **Automatic Fix Branches:** Option for PR Guardian to automatically commit suggested fixes directly to a companion branch.

---

## License

Distributed under the **MIT License**. See `LICENSE` for more information.
