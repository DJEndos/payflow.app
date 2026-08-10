const User = require("../models/User");
const { uploadBuffer } = require("../utils/cloudinary");

// POST /api/kyc/document  (multipart/form-data: file, documentType)
async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const { documentType } = req.body;
    if (!documentType) {
      return res.status(400).json({ success: false, message: "documentType is required" });
    }

    const result = await uploadBuffer(req.file.buffer, `payflow/kyc/${req.user._id}`);

    const user = await User.findById(req.user._id);
    user.kycDocuments.push({ type: documentType, url: result.secure_url });
    if (user.kycStatus === "unverified") user.kycStatus = "pending";
    await user.save();

    return res.json({ success: true, message: "Document uploaded", data: { url: result.secure_url } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
}

module.exports = { uploadDocument };
