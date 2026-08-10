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

/**
 * Returns Paystack's list of Nigerian banks with their transfer codes.
 * Cache this on the frontend/client side where possible — it rarely changes.
 */
async function listBanks() {
  const response = await paystackApi.get("/bank", { params: { country: "nigeria" } });
  return response.data.data; // [{ name, code, ... }]
}

/**
 * Confirms the account name for a given account number + bank code BEFORE
 * money moves — this is what lets the UI show "Confirm: JOHN A DOE" before
 * the user commits to sending money to a typo'd account number.
 */
async function resolveAccountNumber(account_number, bank_code) {
  const response = await paystackApi.get("/bank/resolve", {
    params: { account_number, bank_code },
  });
  return response.data.data; // { account_number, account_name }
}

/**
 * Creates a Paystack transfer recipient. Required before initiating a
 * transfer — Paystack pays out to a recipient object, not raw account details.
 */
async function createTransferRecipient({ name, account_number, bank_code }) {
  const response = await paystackApi.post("/transferrecipient", {
    type: "nuban",
    name,
    account_number,
    bank_code,
    currency: "NGN",
  });
  return response.data.data; // { recipient_code, ... }
}

/**
 * Initiates a payout from your Paystack balance to a recipient's bank account.
 * NOTE: this pulls from your PAYSTACK SETTLEMENT BALANCE, not directly from
 * any one user's wallet entry — that's why the wallet debit happens in our
 * own DB first, then this call actually moves the money out to the bank.
 * In live mode, Paystack may require OTP finalization for transfers
 * (POST /transfer/finalize_transfer) depending on your account settings —
 * test mode transfers typically complete without it.
 */
async function initiateTransfer({ amount, recipient_code, reason, reference }) {
  const response = await paystackApi.post("/transfer", {
    source: "balance",
    amount: Math.round(amount * 100),
    recipient: recipient_code,
    reason,
    reference,
  });
  return response.data.data; // { status, transfer_code, reference, ... }
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  listBanks,
  resolveAccountNumber,
  createTransferRecipient,
  initiateTransfer,
};
