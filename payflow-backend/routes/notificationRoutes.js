const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getMyNotifications, markAsRead } = require("../controllers/notificationController");

router.get("/", protect, getMyNotifications);
router.post("/:id/read", protect, markAsRead);

module.exports = router;
