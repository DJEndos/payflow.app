const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendResetPasswordEmail } = require("../utils/email");
const { verifyBvn: verifyBvnWithVendor } = require("../utils/bvn");
const { verifyNin } = require("../utils/nin");

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function calculateAge(dob) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Validates DOB (18+) and NIN format, then verifies the NIN against NIMC's
 * database via the vendor. Fails OPEN on vendor downtime (registration/profile
 * completion proceeds as unverified) but fails CLOSED if the vendor responds
 * and says the NIN is genuinely invalid/not found.
 * Returns { ok: true, ninVerified } or { ok: false, status, message }.
 */
async function validateAndVerifyIdentity({ dateOfBirth, nin, fullName }) {
  if (!dateOfBirth || !nin) {
    return { ok: false, status: 400, message: "Date of birth and NIN are required" };
  }
  if (!/^\d{11}$/.test(nin)) {
    return { ok: false, status: 400, message: "NIN must be exactly 11 digits" };
  }
  if (isNaN(new Date(dateOfBirth).getTime()) || calculateAge(dateOfBirth) < 18) {
    return { ok: false, status: 400, message: "You must be at least 18 years old" };
  }

  let ninVerified = false;
  const [firstName, ...lastNameParts] = fullName.trim().split(" ");
  const lastName = lastNameParts.join(" ");

  try {
    const result = await verifyNin({ nin, firstName, lastName, dateOfBirth });
    if (result.status !== "found") {
      return { ok: false, status: 400, message: "We couldn't verify this NIN. Please check the number and try again." };
    }
    ninVerified = true;
  } catch (vendorErr) {
    console.error("NIN verification vendor error (failing open):", vendorErr.response?.data || vendorErr.message);
  }

  return { ok: true, ninVerified };
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { fullName, email, phone, password, businessName, dateOfBirth, nin } = req.body;

    if (!fullName || !email || !phone || !password || !dateOfBirth || !nin) {
      return res.status(400).json({ success: false, message: "All fields are required, including date of birth and NIN" });
    }

    // Normalize to 11-digit local format (e.g. 08012345678), whether the
    // user typed +234, 234, or the local format.
    let normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.startsWith("234")) normalizedPhone = "0" + normalizedPhone.slice(3);
    if (!/^0\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({ success: false, message: "Enter a valid Nigerian phone number" });
    }

    const existing = await User.findOne({ $or: [{ email }, { phone: normalizedPhone }, { nin }] });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email, phone, or NIN already registered" });
    }

    const identity = await validateAndVerifyIdentity({ dateOfBirth, nin, fullName });
    if (!identity.ok) {
      return res.status(identity.status).json({ success: false, message: identity.message });
    }

    const user = await User.create({
      fullName,
      email,
      phone: normalizedPhone,
      password,
      businessName,
      dateOfBirth,
      nin,
      ninVerified: identity.ninVerified,
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
  // req.user has password/pin excluded by the auth middleware (on purpose —
  // we never want the hash in a response). Check pin existence separately.
  const hasPin = !!(await User.exists({ _id: req.user._id, pin: { $ne: null } }));

  return res.json({
    success: true,
    data: {
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      businessName: req.user.businessName,
      accountNumber: req.user.accountNumber,
      walletBalance: req.user.walletBalance,
      hasPin,
      dateOfBirth: req.user.dateOfBirth,
      ninVerified: req.user.ninVerified,
      bvnVerified: req.user.bvnVerified,
      bvnLast4: req.user.bvnLast4,
      bvnVerifiedName: req.user.bvnVerifiedName,
      kycStatus: req.user.kycStatus,
      kycRejectionReason: req.user.kycRejectionReason,
      kycDocuments: req.user.kycDocuments,
      isAdmin: req.user.isAdmin,
    },
  });
}

// PATCH /api/user/profile  { businessName }
async function updateProfile(req, res) {
  try {
    const { businessName } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { businessName },
      { new: true }
    );
    return res.json({ success: true, message: "Profile updated", data: { businessName: user.businessName } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Could not update profile" });
  }
}

// POST /api/user/verify-bvn  { bvn }
// Verifies the BVN against the vendor and stores ONLY a masked reference —
// never the raw 11-digit BVN itself. Uses the DOB already captured at
// registration rather than asking the user to type it again.
async function verifyBvn(req, res) {
  try {
    const { bvn } = req.body;

    if (!bvn || !/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ success: false, message: "BVN must be exactly 11 digits" });
    }

    const [firstName, ...rest] = req.user.fullName.trim().split(/\s+/);
    const lastName = rest[rest.length - 1];

    const result = await verifyBvnWithVendor({ bvn, firstName, lastName, dateOfBirth: req.user.dateOfBirth });

    if (result.status !== "found") {
      return res.status(400).json({ success: false, message: "BVN could not be verified" });
    }

    // If we asked for a name/DOB match and it failed, don't mark verified —
    // this stops someone entering a BVN that isn't theirs.
    if (result.dataValidation === false) {
      return res.status(400).json({
        success: false,
        message: "The name or date of birth provided doesn't match this BVN's records",
      });
    }

    await User.findByIdAndUpdate(req.user._id, {
      bvnVerified: true,
      bvnLast4: bvn.slice(-4),
      bvnVerifiedName: `${result.firstName || ""} ${result.lastName || ""}`.trim(),
      bvnDateOfBirth: result.dateOfBirth || null,
      // Both ID checks done -> move into pending admin review. Full "verified"
      // status still needs a human to check the uploaded KYC documents too.
      ...(req.user.kycStatus === "unverified" && { kycStatus: "pending" }),
    });

    return res.json({ success: true, message: "BVN verified successfully" });
  } catch (err) {
    console.error("BVN verification failed:", err.response?.data || err.message || err);
    return res.status(502).json({ success: false, message: "Could not reach the verification service. Try again shortly." });
  }
}

// POST /api/user/set-pin  { newPin, password, currentPin? }
// Sets the transaction PIN for the first time, or changes it. Changing an
// existing PIN requires the current one; setting it for the first time
// requires the account password instead, so it can't be set by anyone who
// merely has a stolen/leftover logged-in session.
async function setTransactionPin(req, res) {
  try {
    const { newPin, password, currentPin } = req.body;

    if (!newPin || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits" });
    }

    const user = await User.findById(req.user._id);
    const hadPinBefore = !!user.pin;

    if (user.pin) {
      if (!currentPin || !(await user.comparePin(currentPin))) {
        return res.status(401).json({ success: false, message: "Current PIN is incorrect" });
      }
    } else {
      if (!password || !(await user.comparePassword(password))) {
        return res.status(401).json({ success: false, message: "Incorrect password" });
      }
    }

    await user.setPin(newPin);
    await user.save();

    return res.json({ success: true, message: hadPinBefore ? "PIN updated" : "Transaction PIN set" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/user/complete-profile  { dateOfBirth, nin }
// For users who registered BEFORE dateOfBirth/NIN were required. Uses the
// exact same validation/verification path as new registrations.
async function completeProfile(req, res) {
  try {
    const { dateOfBirth, nin } = req.body;

    if (req.user.dateOfBirth && req.user.nin) {
      return res.status(400).json({ success: false, message: "Your profile is already complete" });
    }

    // NIN uniqueness check - a legacy user's NIN could theoretically collide
    // with someone who registered after them under the new required flow.
    const ninTaken = await User.findOne({ nin, _id: { $ne: req.user._id } });
    if (ninTaken) {
      return res.status(409).json({ success: false, message: "This NIN is already registered to another account" });
    }

    const identity = await validateAndVerifyIdentity({ dateOfBirth, nin, fullName: req.user.fullName });
    if (!identity.ok) {
      return res.status(identity.status).json({ success: false, message: identity.message });
    }

    await User.findByIdAndUpdate(req.user._id, {
      dateOfBirth,
      nin,
      ninVerified: identity.ninVerified,
    });

    return res.json({ success: true, message: "Profile completed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  setTransactionPin,
  updateProfile,
  verifyBvn,
  completeProfile,
};
