const { GoogleGenAI, Type } = require("@google/genai");

const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const VALID_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "QUALITY"];

const SYSTEM_INSTRUCTIONS = `You are PR Guardian, an expert senior staff software engineer and automated code reviewer operating directly inside a GitHub Pull Request workflow.

Your mission is to perform a rigorous, accurate, and constructive review of the pull request diff. You are NOT a generic chatbot — you act as an experienced engineering teammate focused solely on concrete, actionable issues.

Review Scope:
1. BUGS:
   - Logic errors, off-by-one errors, broken conditions
   - Null/undefined dereferences, missing null-checks
   - Async/await mistakes, unhandled promise rejections, race conditions
   - Incorrect API calls, bad error handling, edge cases

2. SECURITY:
   - Hardcoded secrets, API keys, credentials, tokens
   - Injection vulnerabilities (SQL, Command, XSS, Path traversal)
   - Insecure input validation, unsafe deserialization, authentication/authorization gaps
   - Insecure data exposure, dangerous execution

3. PERFORMANCE:
   - Inefficient algorithms, unnecessary loops, O(N^2) complexity where avoidable
   - Unbatched/repeated database or API calls in loops (N+1 queries)
   - Unbounded memory growth, memory leaks, blocking synchronous operations
   - Redundant network requests or heavy allocations

4. QUALITY:
   - High cyclomatic complexity, deeply nested logic, duplicate code
   - Fragile patterns that hurt maintainability
   - Critical missing error recovery

Rules & Guidelines:
- Analyze ONLY the changed code provided in the diff.
- Point to specific files and the exact new line numbers (the '+' side of the diff).
- DO NOT report trivial style preferences, formatting, or indentation unless it causes behavioral bugs.
- Keep findings concise, high-signal, and actionable. Avoid false positives.
- If the diff contains no actionable problems, return an empty findings array and an encouraging summary.
- Strict JSON response matching the required schema. Never wrap response in markdown fences.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: "A concise 1-3 sentence summary of the pull request review findings.",
    },
    findings: {
      type: Type.ARRAY,
      description: "List of actionable findings identified in the diff.",
      items: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            enum: VALID_SEVERITIES,
            description: "Severity level of the finding.",
          },
          category: {
            type: Type.STRING,
            enum: VALID_CATEGORIES,
            description: "Category of the finding.",
          },
          file: {
            type: Type.STRING,
            description: "Relative file path of the finding.",
          },
          line: {
            type: Type.INTEGER,
            description: "Line number in the new version of the file (+ side of diff).",
          },
          title: {
            type: Type.STRING,
            description: "Short, descriptive title of the issue (e.g. 'Hardcoded API Key Detected').",
          },
          explanation: {
            type: Type.STRING,
            description: "Clear explanation of what is wrong.",
          },
          impact: {
            type: Type.STRING,
            description: "Concrete impact or consequence if this code ships to production.",
          },
          suggested_fix: {
            type: Type.STRING,
            description: "Clear actionable advice on how to fix the problem.",
          },
          suggested_code: {
            type: Type.STRING,
            description: "Optional code snippet showing the corrected code, or empty string/null if not applicable.",
          },
        },
        required: [
          "severity",
          "category",
          "file",
          "line",
          "title",
          "explanation",
          "impact",
          "suggested_fix",
        ],
      },
    },
  },
  required: ["summary", "findings"],
};

function buildUserPrompt(diffText) {
  return `Please review the following Pull Request diff according to your instructions.
Return ONLY valid JSON matching the schema with "summary" and "findings".

PULL REQUEST DIFF:
${diffText}`;
}

class GeminiReviewer {
  constructor({ apiKey, model } = {}) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required to initialize GeminiReviewer.");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  /**
   * Reviews diff text using Gemini with retries on rate limits or network issues.
   * @param {string} diffText
   * @param {object} options
   * @returns {Promise<{ summary: string, findings: Array<object> }>}
   */
  async reviewDiff(diffText, { maxRetries = 3 } = {}) {
    if (!diffText || !diffText.trim()) {
      return {
        summary: "No diff content provided to review.",
        findings: [],
      };
    }

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: buildUserPrompt(diffText),
          config: {
            systemInstruction: SYSTEM_INSTRUCTIONS,
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });

        const rawText = response.text;
        if (!rawText || !rawText.trim()) {
          throw new Error("Gemini returned an empty response.");
        }

        const parsed = this._parseAndValidateResponse(rawText);
        return parsed;
      } catch (err) {
        lastError = err;
        const isRateLimit = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED"));
        const isTransient = err.message && (err.message.includes("503") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT"));

        if ((isRateLimit || isTransient) && attempt < maxRetries) {
          const delayMs = attempt * 2000;
          console.warn(`[GeminiReviewer] Transient error on attempt ${attempt} (${err.message}). Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          break;
        }
      }
    }

    throw new Error(`Gemini review failed after ${maxRetries} attempt(s): ${lastError.message}`);
  }

  _parseAndValidateResponse(rawText) {
    let parsed;
    try {
      // Strip markdown code fences if present
      let cleaned = rawText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/```\s*$/, "");
      }
      cleaned = cleaned.trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`Gemini response was not valid JSON: ${err.message}\nRaw response:\n${rawText.slice(0, 500)}`);
    }

    const summary = typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "PR review completed.";

    const rawFindings = Array.isArray(parsed.findings)
      ? parsed.findings
      : Array.isArray(parsed.issues)
      ? parsed.issues
      : [];

    const validatedFindings = rawFindings
      .map((f) => this._normalizeFinding(f))
      .filter((f) => this._isValidFinding(f));

    return {
      summary,
      findings: validatedFindings,
    };
  }

  _normalizeFinding(finding) {
    if (!finding || typeof finding !== "object") return null;

    // Normalize severity to uppercase
    let severity = (finding.severity || "").toString().trim().toUpperCase();
    if (!VALID_SEVERITIES.includes(severity)) {
      if (severity === "CRIT") severity = "CRITICAL";
      else if (severity === "MED") severity = "MEDIUM";
      else severity = "MEDIUM";
    }

    // Normalize category to uppercase
    let category = (finding.category || "").toString().trim().toUpperCase();
    if (!VALID_CATEGORIES.includes(category)) {
      if (category.includes("BUG") || category.includes("LOGIC")) category = "BUG";
      else if (category.includes("SEC") || category.includes("VULN")) category = "SECURITY";
      else if (category.includes("PERF") || category.includes("SLOW")) category = "PERFORMANCE";
      else category = "QUALITY";
    }

    const lineNum = parseInt(finding.line, 10);

    return {
      severity,
      category,
      file: (finding.file || "").toString().trim(),
      line: isNaN(lineNum) ? 1 : lineNum,
      title: (finding.title || `${severity} ${category} Issue`).toString().trim(),
      explanation: (finding.explanation || "").toString().trim(),
      impact: (finding.impact || finding.why_it_matters || "May impact system reliability or security.").toString().trim(),
      suggested_fix: (finding.suggested_fix || "Review and revise this logic.").toString().trim(),
      suggested_code: finding.suggested_code || finding.corrected_code || null,
    };
  }

  _isValidFinding(f) {
    if (!f) return false;
    if (!f.file || !f.explanation) return false;
    if (!VALID_SEVERITIES.includes(f.severity)) return false;
    if (!VALID_CATEGORIES.includes(f.category)) return false;
    return true;
  }
}

module.exports = {
  GeminiReviewer,
  VALID_SEVERITIES,
  VALID_CATEGORIES,
  SYSTEM_INSTRUCTIONS,
};
