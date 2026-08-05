const crypto = require("crypto");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { initializeTransaction, verifyTransaction } = require("../utils/paystack");

// GET /api/wallet/qr-code -> returns a base64 QR image encoding this user's payment link
async function getQrCode(req, res) {
  try {
    const payLink = `${process.env.FRONTEND_URL}/pay.html?account=${req.user.accountNumber}`;
    const qrImage = await QRCode.toDataURL(payLink);
    return res.json({ success: true, data: { payLink, qrImage } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Could not generate QR code" });
  }
}

// GET /api/wallet/account/:accountNumber -> PUBLIC. Used by the pay.html page
// to show who the customer is paying, without exposing anything sensitive.
async function getPublicAccount(req, res) {
  try {
    const user = await User.findOne({ accountNumber: req.params.accountNumber });
    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    return res.json({
      success: true,
      data: { accountNumber: user.accountNumber, displayName: user.businessName || user.fullName },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/wallet/fund/initialize -> starts a Paystack checkout to fund the wallet
async function initializeFunding(req, res) {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid amount" });
    }

    const reference = `FUND-${req.user._id}-${Date.now()}`;

    await Transaction.create({
      user: req.user._id,
      type: "fund",
      amount,
      reference,
      status: "pending",
    });

    const paystackData = await initializeTransaction({
      email: req.user.email,
      amount,
      reference,
      callback_url: `${process.env.FRONTEND_URL}/fund-callback.html`,
    });

    return res.json({ success: true, data: paystackData });
  } catch (err) {
    console.error(err.response?.data || err);
    return res.status(500).json({ success: false, message: "Could not initialize funding" });
  }
}

// Shared, idempotent: verifies a reference with Paystack directly and credits
// the wallet if it hasn't been credited already. Safe to call from the webhook
// AND from a frontend poll — whichever gets there first does the crediting,
// and the pending->success check stops it ever happening twice.
async function finalizeTransaction(reference) {
  const transaction = await Transaction.findOne({ reference });
  if (!transaction) return { status: "not_found" };
  if (transaction.status === "success") return { status: "success" };

  const verified = await verifyTransaction(reference);
  if (verified.status !== "success") {
    if (verified.status === "failed" && transaction.status !== "failed") {
      transaction.status = "failed";
      await transaction.save();
    }
    return { status: verified.status };
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const fresh = await Transaction.findOne({ reference }).session(session);
    if (fresh.status !== "success") {
      fresh.status = "success";
      await fresh.save({ session });
      await User.findByIdAndUpdate(fresh.user, { $inc: { walletBalance: fresh.amount } }, { session });
    }
    await session.commitTransaction();
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }

  return { status: "success" };
}

// GET /api/wallet/fund/status/:reference -> PUBLIC. Polled by the callback
// page right after checkout. Doubles as a safety net if the webhook is
// misconfigured or unreachable (e.g. testing on localhost without ngrok).
async function getFundingStatus(req, res) {
  try {
    const result = await finalizeTransaction(req.params.reference);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Could not check payment status" });
  }
}

// POST /api/wallet/fund/webhook -> Paystack server-to-server webhook.
async function paystackWebhook(req, res) {
  try {
    const signature = req.headers["x-paystack-signature"];
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== signature) {
      console.warn("Paystack webhook signature mismatch — rejecting");
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;

    if (event.event === "charge.success") {
      await finalizeTransaction(event.data.reference);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
}

// POST /api/wallet/transfer -> send money to another PayFlow user by account number
// POST /api/wallet/transfer -> send money to another PayFlow user by account number
async function transfer(req, res) {
  const session = await mongoose.startSession();
  try {
    const { toAccountNumber, pin } = req.body;
    const amount = Number(req.body.amount);

    if (!toAccountNumber || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Recipient and valid amount required" });
    }

    const sender = await User.findById(req.user._id);
    if (!sender.pin) {
      return res.status(400).json({ success: false, message: "Set a transaction PIN before sending money" });
    }
    if (!(await sender.comparePin(pin))) {
      return res.status(401).json({ success: false, message: "Incorrect transaction PIN" });
    }

    if (sender.walletBalance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const recipient = await User.findOne({ accountNumber: toAccountNumber });
    if (!recipient) {
      return res.status(404).json({ success: false, message: "Recipient account not found" });
    }
    if (recipient._id.equals(sender._id)) {
      return res.status(400).json({ success: false, message: "Cannot transfer to yourself" });
    }

    const reference = `TRF-${sender._id}-${Date.now()}`;

    session.startTransaction();

    sender.walletBalance -= amount;
    await sender.save({ session });

    recipient.walletBalance += amount;
    await recipient.save({ session });

    // ordered: true is required by Mongoose whenever create() is called with
    // both an array of documents AND a session — omitting it throws every time.
    await Transaction.create(
      [
        {
          user: sender._id,
          type: "send",
          amount,
          reference: `${reference}-OUT`,
          status: "success",
          counterpartyAccountNumber: recipient.accountNumber,
        },
        {
          user: recipient._id,
          type: "receive",
          amount,
          reference: `${reference}-IN`,
          status: "success",
          counterpartyAccountNumber: sender.accountNumber,
        },
      ],
      { session, ordered: true }
    );

    await session.commitTransaction();

    return res.json({ success: true, message: "Transfer successful" });
  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    return res.status(500).json({ success: false, message: "Transfer failed" });
  } finally {
    session.endSession();
  }
}
// GET /api/wallet/transactions
async function getTransactions(req, res) {
  const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ success: true, data: transactions });
}

// POST /api/wallet/pay/:accountNumber -> PUBLIC. This is what the QR-code
// page calls. No login required — the payer is a customer, not a PayFlow
// user. Money lands in the recipient's wallet once the webhook confirms it.
async function payViaQr(req, res) {
  try {
    const { accountNumber } = req.params;
    const { email, amount } = req.body;

    if (!email || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Email and a valid amount are required" });
    }

    const recipient = await User.findOne({ accountNumber });
    if (!recipient) {
      return res.status(404).json({ success: false, message: "Recipient account not found" });
    }

    const reference = `QR-${recipient._id}-${Date.now()}`;

    await Transaction.create({
      user: recipient._id,
      type: "receive",
      amount,
      reference,
      status: "pending",
      meta: { payerEmail: email, viaQr: true },
    });

    const paystackData = await initializeTransaction({
      email,
      amount,
      reference,
      callback_url: `${process.env.FRONTEND_URL}/fund-callback.html`,
    });

    return res.json({ success: true, data: paystackData });
  } catch (err) {
    console.error(err.response?.data || err);
    return res.status(500).json({ success: false, message: "Could not start payment" });
  }
}

module.exports = {
  getQrCode,
  getPublicAccount,
  initializeFunding,
  payViaQr,
  paystackWebhook,
  getFundingStatus,
  transfer,
  getTransactions,
};
