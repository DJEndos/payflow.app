const axios = require("axios");

const flwApi = axios.create({
  baseURL: "https://api.flutterwave.com/v3",
  headers: {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

/**
 * Validates a customer before payment where required (mainly for
 * electricity meter numbers) using Flutterwave's bill item validation.
 * item_code and biller_code come from the Bill Categories endpoint
 * for the specific disco (e.g. IKEDC, EKEDC).
 */
async function validateCustomer({ item_code, code, customer }) {
  const response = await flwApi.get(`/bill-items/${item_code}/validate`, {
    params: { code, customer },
  });
  return response.data.data;
}

/**
 * Pays a bill: airtime, data bundle, or electricity token.
 * type examples: "AIRTIME", "MOBILE_DATA", "PREPAID"/"POSTPAID" (electricity)
 */
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

module.exports = { validateCustomer, payBill, getBillStatus };
