const express = require("express");
const router = express.Router();
const { protect, requireCompleteProfile } = require("../middleware/auth");
const {
  getQrCode,
  getPublicAccount,
  initializeFunding,
  payViaQr,
  transfer,
  getTransactions,
  getFundingStatus,
  getBanks,
  resolveBankAccount,
  transferToBank,
} = require("../controllers/walletController");

// Public — no auth. This is what the QR code page hits.
router.post("/pay/:accountNumber", payViaQr);
router.get("/account/:accountNumber", getPublicAccount);

// Public — the callback page polls this right after checkout, whether the
// payer is a logged-in user (own wallet) or an anonymous QR customer.
router.get("/fund/status/:reference", getFundingStatus);

router.get("/qr-code", protect, getQrCode);
router.post("/fund/initialize", protect, initializeFunding); // funding IN is always allowed
router.post("/transfer", protect, requireCompleteProfile, transfer); // sending OUT requires complete profile
router.get("/transactions", protect, getTransactions);

router.get("/banks", protect, getBanks); // just browsing bank list - fine either way
router.get("/resolve-account", protect, resolveBankAccount); // just a name lookup, no money moves
router.post("/transfer-to-bank", protect, requireCompleteProfile, transferToBank);

module.exports = router;
