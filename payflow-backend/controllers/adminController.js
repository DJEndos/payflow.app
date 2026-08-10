const User = require("../models/User");
const Notification = require("../models/Notification");

// GET /api/admin/users?kycStatus=pending
async function listUsers(req, res) {
  try {
    const filter = {};
    if (req.query.kycStatus) filter.kycStatus = req.query.kycStatus;

    const users = await User.find(filter)
      .select("fullName email phone accountNumber businessName walletBalance kycStatus bvnVerified ninVerified createdAt")
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, data: users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// GET /api/admin/users/:id -> full detail including KYC documents, for review
async function getUserDetail(req, res) {
  try {
    const user = await User.findById(req.params.id).select("-password -pin");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/admin/users/:id/kyc  { status: "verified" | "rejected", reason? }
async function updateKycStatus(req, res) {
  try {
    const { status, reason } = req.body;
    if (!["verified", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.kycStatus = status;
    user.kycRejectionReason = status === "rejected" ? reason || "Not specified" : null;
    await user.save();

    return res.json({ success: true, message: `KYC marked as ${status}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/admin/notifications  { title, message, targetUserIds? }
// Omitting targetUserIds broadcasts to every user.
async function createNotification(req, res) {
  try {
    const { title, message, targetUserIds } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const notification = await Notification.create({
      title,
      message,
      createdBy: req.user._id,
      targetUsers: Array.isArray(targetUserIds) ? targetUserIds : [],
    });

    return res.status(201).json({ success: true, message: "Notification sent", data: notification });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { listUsers, getUserDetail, updateKycStatus, createNotification };
