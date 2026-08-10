const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getMe, setTransactionPin, updateProfile, verifyBvn, getBvnStatus, completeProfile } = require("../controllers/authController");

router.get("/me", protect, getMe);
router.post("/set-pin", protect, setTransactionPin);
router.patch("/profile", protect, updateProfile);
router.post("/verify-bvn", protect, verifyBvn);
router.get("/bvn-status", protect, getBvnStatus);
router.post("/complete-profile", protect, completeProfile);

module.exports = router;
