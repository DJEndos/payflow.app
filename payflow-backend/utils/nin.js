const axios = require("axios");

const youverifyApi = axios.create({
  baseURL: process.env.YOUVERIFY_BASE_URL || "https://api.youverify.co",
  headers: {
    token: process.env.YOUVERIFY_API_KEY,
    "Content-Type": "application/json",
  },
});

/**
 * Verifies a NIN against NIMC's database via Youverify. Used at registration
 * to confirm the NIN is real and (optionally) matches the name/DOB supplied,
 * rather than just accepting whatever 11 digits the user typed.
 */
async function verifyNin({ nin, firstName, lastName, dateOfBirth }) {
  const body = {
    id: nin,
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

  const response = await youverifyApi.post("/v2/api/identity/ng/nin", body);
  return response.data.data; // { status, firstName, lastName, dateOfBirth, dataValidation, ... }
}

module.exports = { verifyNin };
