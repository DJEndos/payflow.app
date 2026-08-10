const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { validateCustomer, payBill } = require("../utils/flutterwave");

/**
 * Shared helper: debit wallet, call Flutterwave, record transaction.
 * If Flutterwave fails, the wallet debit is rolled back.
 */
async function processBillPayment({ user, type, amount: rawAmount, customer, biller_name, meta = {} }) {
  const amount = Number(rawAmount);
  if (!amount || amount <= 0) {
    throw Object.assign(new Error("Enter a valid amount"), { status: 400 });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const freshUser = await User.findById(user._id).session(session);
    if (freshUser.walletBalance < amount) {
      throw Object.assign(new Error("Insufficient wallet balance"), { status: 400 });
    }

    freshUser.walletBalance -= amount;
    await freshUser.save({ session });

    const reference = `${type.toUpperCase()}-${user._id}-${Date.now()}`;

    const transaction = await Transaction.create(
      [
        {
          user: user._id,
          type,
          amount,
          reference,
          status: "pending",
          meta: { customer, biller_name, ...meta },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Call Flutterwave AFTER committing the debit, so wallet state is consistent
    // even if the biller call is slow or fails.
    try {
      const result = await payBill({ customer, amount, type: biller_name.apiType, biller_name: biller_name.name, reference });

      await Transaction.findOneAndUpdate(
        { reference },
        { status: result.status === "successful" ? "success" : "failed", "meta.flwResponse": result }
      );

      if (result.status !== "successful") {
        // Refund on failure
        await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: amount } });
      }

      return { success: result.status === "successful", reference, result };
    } catch (flwErr) {
      // This was previously swallowed entirely — logging it is what actually
      // lets us see WHY Flutterwave rejected the request (wrong key, wrong
      // biller code, insufficient test balance, etc.) instead of guessing.
      console.error("Flutterwave bill payment failed:", flwErr.response?.data || flwErr.message || flwErr);

      // Refund on API failure
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: amount } });
      await Transaction.findOneAndUpdate({ reference }, { status: "failed" });
      throw Object.assign(new Error("Biller could not process this payment. You have been refunded."), {
        status: 502,
      });
    }
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

// POST /api/bills/airtime  { phone, network, amount }
async function buyAirtime(req, res) {
  try {
    const { phone, network, amount } = req.body;
    if (!phone || !network || !amount) {
      return res.status(400).json({ success: false, message: "Phone, network, and amount required" });
    }

    const result = await processBillPayment({
      user: req.user,
      type: "airtime",
      amount,
      customer: phone,
      biller_name: { name: network, apiType: "AIRTIME" },
    });

    return res.json({ success: result.success, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /api/bills/data  { phone, network, planCode, amount }
async function buyData(req, res) {
  try {
    const { phone, network, planCode, amount } = req.body;
    if (!phone || !network || !amount) {
      return res.status(400).json({ success: false, message: "Phone, network, and amount required" });
    }

    const result = await processBillPayment({
      user: req.user,
      type: "data",
      amount,
      customer: phone,
      biller_name: { name: network, apiType: "MOBILE_DATA" },
      meta: { planCode },
    });

    return res.json({ success: result.success, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /api/bills/electricity/validate?meterNumber=&itemCode=&billerCode=
async function validateMeter(req, res) {
  try {
    const { meterNumber, itemCode, billerCode } = req.query;
    const data = await validateCustomer({ item_code: itemCode, code: billerCode, customer: meterNumber });
    return res.json({ success: true, data });
  } catch (err) {
    console.error(err.response?.data || err);
    return res.status(400).json({ success: false, message: "Could not validate meter number" });
  }
}

// POST /api/bills/electricity/pay  { meterNumber, disco, meterType, amount }
async function payElectricity(req, res) {
  try {
    const { meterNumber, disco, meterType, amount } = req.body;
    if (!meterNumber || !disco || !amount) {
      return res.status(400).json({ success: false, message: "Meter number, disco, and amount required" });
    }

    const result = await processBillPayment({
      user: req.user,
      type: "electricity",
      amount,
      customer: meterNumber,
      biller_name: { name: disco, apiType: meterType === "postpaid" ? "POSTPAID" : "PREPAID" },
    });

    return res.json({ success: result.success, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = { buyAirtime, buyData, validateMeter, payElectricity };
