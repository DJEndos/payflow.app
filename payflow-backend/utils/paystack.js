const axios = require("axios");

const paystackApi = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

/**
 * Initializes a Paystack transaction. Returns an authorization_url
 * that the frontend redirects the user to (this is what the QR
 * code page opens). The user picks Card / Bank Transfer / USSD there.
 */
async function initializeTransaction({ email, amount, reference, callback_url }) {
  const response = await paystackApi.post("/transaction/initialize", {
    email,
    amount: Math.round(amount * 100), // Paystack expects kobo
    reference,
    callback_url,
  });
  return response.data.data; // { authorization_url, access_code, reference }
}

/**
 * Verifies a transaction server-side. ALWAYS call this before crediting
 * a wallet — never trust the frontend redirect alone.
 */
async function verifyTransaction(reference) {
  const response = await paystackApi.get(`/transaction/verify/${reference}`);
  return response.data.data; // { status, amount, reference, ... }
}

module.exports = { initializeTransaction, verifyTransaction };
