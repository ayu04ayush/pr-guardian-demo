/**
 * HACKATHON DEMO FIXTURE: Vulnerable Sample Code
 * 
 * Intentional flaws for PR Guardian demonstration:
 * 1. [SECURITY - CRITICAL] Hardcoded production API key
 * 2. [SECURITY - CRITICAL] SQL Injection via raw string concatenation
 * 3. [BUG - HIGH] Off-by-one loop boundary causing undefined reference
 * 4. [PERFORMANCE - MEDIUM] Sequential unbatched queries in loop (N+1 query)
 * 5. [QUALITY - LOW] Missing try/catch around network/database call
 */

// ❌ FLAW 1: Hardcoded production credentials committed to repository
const STRIPE_SECRET_KEY = "sk_live_51M0demo99887766554433221100aa";

async function authenticateAndFetch(db, username, password) {
  // ❌ FLAW 2: Direct SQL injection vulnerability
  const query = "SELECT * FROM users WHERE username = '" + username + "' AND password_hash = '" + password + "'";
  
  // ❌ FLAW 5: Unhandled rejection risk — no error handling
  const user = await db.query(query);
  return user;
}

async function fetchTeamProfiles(db, teamMemberIds) {
  const profiles = [];

  // ❌ FLAW 3: Off-by-one error (<= instead of <) causes out-of-bounds access
  for (let i = 0; i <= teamMemberIds.length; i++) {
    const memberId = teamMemberIds[i];

    // ❌ FLAW 4: Sequential N+1 query inside loop
    const profile = await db.query("SELECT id, name, email FROM profiles WHERE id = ?", [memberId]);
    profiles.push(profile);
  }

  return profiles;
}

module.exports = {
  STRIPE_SECRET_KEY,
  authenticateAndFetch,
  fetchTeamProfiles,
};
function testBug(user) {
    return user.name;
}

const secret = "test-secret-123";
