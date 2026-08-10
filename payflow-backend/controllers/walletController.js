const crypto = require("crypto");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const {
  initializeTransaction,
  verifyTransaction,
  listBanks,
  resolveAccountNumber,
  createTransferRecipient,
  initiateTransfer,
} = require("../utils/paystack");

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

    if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
      const reference = event.data.reference;
      const finalStatus = event.event === "transfer.success" ? "success" : "failed";

      const transaction = await Transaction.findOne({ reference });
      if (transaction && transaction.status !== finalStatus) {
        transaction.status = finalStatus;
        transaction.meta = { ...transaction.meta, paystackFinalEvent: event.data };
        await transaction.save();

        // If the transfer ultimately failed/reversed after we'd already
        // marked it success optimistically, refund the wallet now.
        if (finalStatus === "failed") {
          await User.findByIdAndUpdate(transaction.user, { $inc: { walletBalance: transaction.amount } });
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
}

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

// GET /api/wallet/banks -> list of Nigerian banks for the "send to bank" dropdown
async function getBanks(req, res) {
  try {
    const banks = await listBanks();
    return res.json({ success: true, data: banks });
  } catch (err) {
    console.error("Could not fetch bank list:", err.response?.data || err.message);
    return res.status(502).json({ success: false, message: "Could not load bank list" });
  }
}

// GET /api/wallet/resolve-account?accountNumber=&bankCode= -> confirms the account
// holder's name BEFORE the user commits to sending money to it.
async function resolveBankAccount(req, res) {
  try {
    const { accountNumber, bankCode } = req.query;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ success: false, message: "Account number and bank are required" });
    }
    const data = await resolveAccountNumber(accountNumber, bankCode);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("Account resolution failed:", err.response?.data || err.message);
    return res.status(400).json({ success: false, message: "Could not verify this account number" });
  }
}

// POST /api/wallet/transfer-to-bank  { accountNumber, bankCode, accountName, amount, pin }
// Sends money from the wallet to an external Nigerian bank account via Paystack.
async function transferToBank(req, res) {
  const session = await mongoose.startSession();
  try {
    const { accountNumber, bankCode, accountName, pin } = req.body;
    const amount = Number(req.body.amount);

    if (!accountNumber || !bankCode || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Bank details and a valid amount are required" });
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

    const reference = `BTR-${sender._id}-${Date.now()}`;

    // Debit the wallet and record a pending transaction FIRST, inside a DB
    // transaction, before we ever call Paystack — if Paystack's call fails
    // afterward, we refund explicitly (see catch block below).
    session.startTransaction();
    sender.walletBalance -= amount;
    await sender.save({ session });

    await Transaction.create(
      [
        {
          user: sender._id,
          type: "bank_transfer",
          amount,
          reference,
          status: "pending",
          meta: { accountNumber, bankCode, accountName },
        },
      ],
      { session }
    );
    await session.commitTransaction();
    session.endSession();

    try {
      const recipient = await createTransferRecipient({
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
      });

      const transfer = await initiateTransfer({
        amount,
        recipient_code: recipient.recipient_code,
        reason: "PayFlow bank transfer",
        reference,
      });

      // Paystack transfers are often asynchronous — "success" here means it
      // was ACCEPTED, not necessarily settled. Final status arrives via the
      // transfer.success / transfer.failed webhook, handled below.
      await Transaction.findOneAndUpdate(
        { reference },
        { status: transfer.status === "success" ? "success" : "pending", "meta.paystackTransfer": transfer }
      );

      return res.json({ success: true, message: "Transfer initiated", data: { reference, status: transfer.status } });
    } catch (transferErr) {
      console.error("Bank transfer failed:", transferErr.response?.data || transferErr.message);
      // Refund since the money never actually left for the bank
      await User.findByIdAndUpdate(sender._id, { $inc: { walletBalance: amount } });
      await Transaction.findOneAndUpdate({ reference }, { status: "failed" });
      return res.status(502).json({ success: false, message: "Bank transfer failed. You have been refunded." });
    }
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error(err);
    return res.status(500).json({ success: false, message: "Transfer failed" });
  } finally {
    session.endSession();
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
  getBanks,
  resolveBankAccount,
  transferToBank,
};
