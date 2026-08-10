const axios = require("axios");

// Youverify is the vendor used here since they have NIBSS-backed BVN access
// and clear docs. Other KYC vendors (Prembly/QoreID, Smile ID, VerifyMe) offer
// similar BVN endpoints if you switch providers later — only this file and
// the env vars would need to change.
const youverifyApi = axios.create({
  baseURL: process.env.YOUVERIFY_BASE_URL || "https://api.youverify.co",
  headers: {
    token: process.env.YOUVERIFY_API_KEY,
    "Content-Type": "application/json",
  },
});

/**
 * Verifies a BVN against Youverify's NIBSS-backed database. Optionally
 * cross-checks the supplied firstName/lastName/dateOfBirth against the
 * record (dataValidation) so we're not just trusting whatever the user typed.
 */
async function verifyBvn({ bvn, firstName, lastName, dateOfBirth }) {
  const body = {
    id: bvn,
    isSubjectConsent: true,
  };

  if (firstName || lastName || dateOfBirth) {
    body.validations = {
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(dateOfBirth && { dateOfBirth }),
      },
    };
  }

  const response = await youverifyApi.post("/v2/api/identity/ng/bvn", body);
  return response.data.data; // { status, firstName, lastName, dateOfBirth, mobile, dataValidation, ... }
}

module.exports = { verifyBvn };
