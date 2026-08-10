const express = require("express");
const router = express.Router();
const { protect, requireCompleteProfile } = require("../middleware/auth");
const { buyAirtime, buyData, validateMeter, payElectricity } = require("../controllers/billController");

router.post("/airtime", protect, requireCompleteProfile, buyAirtime);
router.post("/data", protect, requireCompleteProfile, buyData);
router.get("/electricity/validate", protect, validateMeter); // just a lookup, no money moves
router.post("/electricity/pay", protect, requireCompleteProfile, payElectricity);

module.exports = router;
