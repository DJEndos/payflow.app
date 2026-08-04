const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getMe, setTransactionPin } = require("../controllers/authController");

router.get("/me", protect, getMe);
router.post("/set-pin", protect, setTransactionPin);

module.exports = router;
