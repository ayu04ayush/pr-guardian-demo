const crypto = require("crypto");

/**
 * Generates a stable, content-based SHA-256 fingerprint for a finding.
 * 
 * We deliberately base the fingerprint on file + category + normalized title + normalized explanation,
 * rather than strict line numbers alone. This ensures that if subsequent commits shift
 * the line numbers slightly without fixing the underlying issue, PR Guardian recognizes
 * that this issue has already been reported and avoids spamming the PR with duplicates.
 *
 * @param {object} finding
 * @returns {string} 16-character hexadecimal fingerprint
 */
function createFingerprint(finding) {
  const normTitle = (finding.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const normExplanation = (finding.explanation || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const raw = `${finding.file}::${finding.category}::${normTitle}::${normExplanation}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Embeds the fingerprint inside an invisible HTML comment at the end of the markdown body.
 *
 * @param {string} body
 * @param {string} fingerprint
 * @returns {string}
 */
function embedFingerprint(body, fingerprint) {
  return `${body.trim()}\n\n<!-- pr-guardian-fingerprint:${fingerprint} -->`;
}

/**
 * Extracts the fingerprint hash from a comment body.
 * Compatible with both PR Guardian and legacy markers.
 *
 * @param {string} commentBody
 * @returns {string|null}
 */
function extractFingerprint(commentBody) {
  if (!commentBody || typeof commentBody !== "string") return null;
  const match = commentBody.match(/<!-- (?:pr-guardian|ai-review)-fingerprint:([a-f0-9]+) -->/);
  return match ? match[1] : null;
}

module.exports = {
  createFingerprint,
  embedFingerprint,
  extractFingerprint,
};
