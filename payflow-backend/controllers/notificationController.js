const Notification = require("../models/Notification");

// GET /api/notifications -> broadcasts + anything targeted at this user,
// newest first, with a per-user "read" flag computed from readBy.
async function getMyNotifications(req, res) {
  try {
    const notifications = await Notification.find({
      $or: [{ targetUsers: { $size: 0 } }, { targetUsers: req.user._id }],
    })
      .sort({ createdAt: -1 })
      .limit(30);

    const data = notifications.map((n) => ({
      _id: n._id,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt,
      read: n.readBy.some((id) => id.equals(req.user._id)),
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/notifications/:id/read
async function markAsRead(req, res) {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.user._id } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { getMyNotifications, markAsRead };
