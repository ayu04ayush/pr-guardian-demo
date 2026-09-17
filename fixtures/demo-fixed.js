/**
 * HACKATHON DEMO FIXTURE: Remediated / Fixed Code
 * 
 * Demonstrates the second review cycle of PR Guardian:
 * - Fixed credentials: Loaded from environment variables
 * - Fixed SQL Injection: Parameterized query
 * - Fixed loop boundary: Correct strictly-less-than indexing
 * - Fixed N+1 query: Batched query using IN clause or Promise.all
 * - Added robust error handling
 */

// ✅ FIX 1: Loaded securely from environment variables
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.warn("Warning: STRIPE_SECRET_KEY is not set in environment.");
}

async function authenticateAndFetch(db, username, password) {
  try {
    // ✅ FIX 2: Parameterized query prevents SQL injection
    const query = "SELECT id, username, email FROM users WHERE username = ? AND password_hash = ?";
    const [user] = await db.query(query, [username, password]);
    return user || null;
  } catch (err) {
    // ✅ FIX 5: Proper error handling
    console.error(`Authentication query failed for user ${username}:`, err.message);
    throw new Error("Authentication failed due to internal error.");
  }
}

async function fetchTeamProfiles(db, teamMemberIds) {
  if (!Array.isArray(teamMemberIds) || teamMemberIds.length === 0) {
    return [];
  }

  try {
    // ✅ FIX 3: Loop boundary corrected & FIX 4: Batched in parallel or single query
    const placeholders = teamMemberIds.map(() => "?").join(",");
    const profiles = await db.query(
      `SELECT id, name, email FROM profiles WHERE id IN (${placeholders})`,
      teamMemberIds
    );
    return profiles;
  } catch (err) {
    console.error("Failed to fetch team profiles:", err.message);
    throw err;
  }
}

module.exports = {
  STRIPE_SECRET_KEY,
  authenticateAndFetch,
  fetchTeamProfiles,
};
