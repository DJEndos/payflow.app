const express = require("express");
const multer = require("multer");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { uploadDocument } = require("../controllers/kycController");

// Memory storage, not disk — files are forwarded straight to Cloudinary and
// never touch Render's (non-persistent) local filesystem.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.post("/document", protect, upload.single("file"), uploadDocument);

module.exports = router;
