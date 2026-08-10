const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { listUsers, getUserDetail, updateKycStatus, createNotification } = require("../controllers/adminController");

router.use(protect, adminOnly);

router.get("/users", listUsers);
router.get("/users/:id", getUserDetail);
router.post("/users/:id/kyc", updateKycStatus);
router.post("/notifications", createNotification);

module.exports = router;
