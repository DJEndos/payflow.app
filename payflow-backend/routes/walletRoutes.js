const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getQrCode,
  getPublicAccount,
  initializeFunding,
  payViaQr,
  transfer,
  getTransactions,
  getFundingStatus,
} = require("../controllers/walletController");

// Public — no auth. This is what the QR code page hits.
router.post("/pay/:accountNumber", payViaQr);
router.get("/account/:accountNumber", getPublicAccount);

// Public — the callback page polls this right after checkout, whether the
// payer is a logged-in user (own wallet) or an anonymous QR customer.
router.get("/fund/status/:reference", getFundingStatus);

router.get("/qr-code", protect, getQrCode);
router.post("/fund/initialize", protect, initializeFunding);
router.post("/transfer", protect, transfer);
router.get("/transactions", protect, getTransactions);

module.exports = router;
