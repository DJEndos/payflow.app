const axios = require("axios");

const flwApi = axios.create({
  baseURL: "https://api.flutterwave.com/v3",
  headers: {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});


async function validateCustomer({ item_code, code, customer }) {
  const response = await flwApi.get(`/bill-items/${item_code}/validate`, {
    params: { code, customer },
  });
  return response.data.data;
}


async function payBill({ country = "NG", customer, amount, type, biller_name, reference }) {
  const response = await flwApi.post("/bills", {
    country,
    customer, // phone number or meter number
    amount,
    recurrence: "ONCE",
    type,
    biller_name,
    reference,
  });
  return response.data.data;
}

async function getBillStatus(reference) {
  const response = await flwApi.get(`/bills/${reference}`);
  return response.data.data;
}


async function initiateBvnConsent({ bvn, firstname, lastname, redirect_url }) {
  const response = await flwApi.post("/bvn/verifications", { bvn, firstname, lastname, redirect_url });
  return response.data.data; // { url, reference }
}

/**
 * Polls the result of a previously-initiated BVN consent by reference.
 * Once status is "COMPLETED", data.bvn_data contains both the BVN details
 * AND the NIN — one consent flow verifies both at once.
 */
async function getBvnConsentStatus(reference) {
  const response = await flwApi.get(`/bvn/verifications/${reference}`);
  return response.data.data; // { status, bvn_data: { bvn, nin, ... } }
}

module.exports = { validateCustomer, payBill, getBillStatus, initiateBvnConsent, getBvnConsentStatus };
