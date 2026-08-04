const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendResetPasswordEmail } = require("../utils/email");

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { fullName, email, phone, password, businessName } = req.body;

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Normalize to 11-digit local format (e.g. 08012345678), whether the
    // user typed +234, 234, or the local format.
    let normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.startsWith("234")) normalizedPhone = "0" + normalizedPhone.slice(3);
    if (!/^0\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({ success: false, message: "Enter a valid Nigerian phone number" });
    }

    const existing = await User.findOne({ $or: [{ email }, { phone: normalizedPhone }] });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email or phone already registered" });
    }

    const user = await User.create({
      fullName,
      email,
      phone: normalizedPhone,
      password,
      businessName,
      accountNumber: normalizedPhone,
    });

    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        accountNumber: user.accountNumber,
        fullName: user.fullName,
        token,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = signToken(user._id);

    return res.json({
      success: true,
      message: "Login successful",
      data: { accountNumber: user.accountNumber, fullName: user.fullName, token },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
}

// POST /api/auth/forgot-password  { email }
// Always returns a generic success message, whether or not the email exists —
// this stops attackers from using this endpoint to check which emails are registered.
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({ email });

    if (user) {
      // Generate a random token, store only its HASH in the DB (never the raw token —
      // if the database ever leaked, a raw token would let someone reset the account).
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
      await user.save();

      const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${rawToken}`;

      try {
        await sendResetPasswordEmail(user.email, resetLink);
      } catch (mailErr) {
        console.error("Failed to send reset email:", mailErr.message);
        // Roll back the token so a broken mail server doesn't leave a dangling
        // valid reset token the user never received.
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();
        return res.status(500).json({ success: false, message: "Could not send reset email. Try again shortly." });
      }
    }

    return res.json({
      success: true,
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/auth/reset-password/:token  { password }
async function resetPassword(req, res) {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired" });
    }

    user.password = password; // pre-save hook in the model hashes this
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.json({ success: true, message: "Password reset. You can now log in." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// Logout is handled entirely on the frontend by clearing the stored token.
// This endpoint exists only so the frontend has something to call if it wants to.
function logout(req, res) {
  return res.json({ success: true, message: "Logged out" });
}

// GET /api/user/me -> the frontend calls this on every protected page load
// to get the logged-in user's profile and current balance.
async function getMe(req, res) {
  return res.json({
    success: true,
    data: {
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      businessName: req.user.businessName,
      accountNumber: req.user.accountNumber,
      walletBalance: req.user.walletBalance,
    },
  });
}

module.exports = { register, login, logout, forgotPassword, resetPassword, getMe };
