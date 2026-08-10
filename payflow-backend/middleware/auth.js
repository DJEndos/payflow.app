const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Protects API routes: expects Authorization: Bearer <token>
async function protect(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer")) {
      return res.status(401).json({ success: false, message: "Not authorized, no token" });
    }
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password -pin");
    if (!user) {
      return res.status(401).json({ success: false, message: "User no longer exists" });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Not authorized, invalid token" });
  }
}

// Chain AFTER protect on any admin-only route. protect already attaches
// req.user, so this just checks the flag — it never trusts anything the
// client sends, only what's in the database for the authenticated user.
function adminOnly(req, res, next) {
  if (!req.user.isAdmin) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

// Chain AFTER protect on any route that moves money OUT of the wallet
// (transfers, bank transfers, bill payments). Users who registered before
// DOB/NIN were required can still log in, view their balance, receive money,
// and complete their profile — they just can't send money out until they do.
function requireCompleteProfile(req, res, next) {
  if (!req.user.dateOfBirth || !req.user.nin) {
    return res.status(403).json({
      success: false,
      message: "Please complete your profile (date of birth and NIN) before sending money.",
      code: "PROFILE_INCOMPLETE",
    });
  }
  next();
}

module.exports = { protect, adminOnly, requireCompleteProfile };
