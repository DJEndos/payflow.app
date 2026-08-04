const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { buyAirtime, buyData, validateMeter, payElectricity } = require("../controllers/billController");

router.post("/airtime", protect, buyAirtime);
router.post("/data", protect, buyData);
router.get("/electricity/validate", protect, validateMeter);
router.post("/electricity/pay", protect, payElectricity);

module.exports = router;
