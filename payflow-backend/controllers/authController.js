const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendResetPasswordEmail, sendVerificationEmail } = require("../utils/email");
const { initiateBvnConsent, getBvnConsentStatus } = require("../utils/flutterwave");

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
 * Validates DOB (18+) and NIN format only. NIN is NOT verified against any
 * vendor here — Flutterwave's BVN consent flow (see initiateBvn/checkBvnStatus
 * below) verifies BOTH the BVN and the NIN together in one step, so there's
 * no separate NIN-only vendor call anymore. This just stops obviously-wrong
 * input (wrong digit count, underage) from being saved.
 */
function validateIdentityFormat({ dateOfBirth, nin }) {
  if (!dateOfBirth || !nin) {
    return { ok: false, status: 400, message: "Date of birth and NIN are required" };
  }
  if (!/^\d{11}$/.test(nin)) {
    return { ok: false, status: 400, message: "NIN must be exactly 11 digits" };
  }
  if (isNaN(new Date(dateOfBirth).getTime()) || calculateAge(dateOfBirth) < 18) {
    return { ok: false, status: 400, message: "You must be at least 18 years old" };
  }
  return { ok: true };
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

    const identity = validateIdentityFormat({ dateOfBirth, nin });
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
      accountNumber: normalizedPhone,
    });

    // Send the verification email, but never let a mail-server hiccup block
    // registration itself — the user can request a resend from the dashboard
    // if this fails or never arrives.
    try {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
      user.emailVerificationToken = hashedToken;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      await user.save();

      const verifyLink = `${process.env.FRONTEND_URL}/verify-email.html?token=${rawToken}`;
      await sendVerificationEmail(user.email, verifyLink);
    } catch (mailErr) {
      console.error("Failed to send verification email (registration still succeeds):", mailErr.message);
    }

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

// POST /api/auth/verify-email/:token
async function verifyEmail(req, res) {
  try {
    const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "This verification link is invalid or has expired." });
    }

    user.isVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    return res.json({ success: true, message: "Email verified successfully!" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/auth/resend-verification (protected - logged-in users only)
async function resendVerification(req, res) {
  try {
    const user = await User.findById(req.user._id);
    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Your email is already verified." });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.emailVerificationToken = hashedToken;
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    await user.save();

    const verifyLink = `${process.env.FRONTEND_URL}/verify-email.html?token=${rawToken}`;

    try {
      await sendVerificationEmail(user.email, verifyLink);
    } catch (mailErr) {
      console.error("Failed to resend verification email:", mailErr.message);
      return res.status(500).json({ success: false, message: "Could not send email right now. Try again shortly." });
    }

    return res.json({ success: true, message: "Verification email sent! Check your inbox." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
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
      isVerified: req.user.isVerified,
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
// Starts a Flutterwave BVN consent verification. The customer is redirected
// to NIBSS's own portal to confirm consent before anything is retrieved —
// this does NOT complete synchronously. The frontend must redirect the
// browser to the returned redirectUrl, then poll /bvn-status afterward.
async function verifyBvn(req, res) {
  try {
    const { bvn } = req.body;

    if (!bvn || !/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ success: false, message: "BVN must be exactly 11 digits" });
    }

    const [firstname, ...rest] = req.user.fullName.trim().split(/\s+/);
    const lastname = rest[rest.length - 1] || firstname;

    const result = await initiateBvnConsent({
      bvn,
      firstname,
      lastname,
      redirect_url: `${process.env.FRONTEND_URL}/bvn-callback.html`,
    });

    await User.findByIdAndUpdate(req.user._id, { bvnConsentReference: result.reference });

    return res.json({
      success: true,
      message: "BVN verification started",
      data: { redirectUrl: result.url, reference: result.reference },
    });
  } catch (err) {
    console.error("BVN consent initiation failed:", err.response?.data || err.message || err);
    return res.status(502).json({ success: false, message: "Could not start BVN verification. Try again shortly." });
  }
}

// GET /api/user/bvn-status -> polled by the callback page after the customer
// returns from NIBSS's consent portal. Once status is COMPLETED, Flutterwave
// returns BOTH the BVN details AND the NIN in the same payload — so this one
// check verifies both, and there's no separate NIN vendor call needed at all.
async function getBvnStatus(req, res) {
  try {
    const user = await User.findById(req.user._id);
    if (!user.bvnConsentReference) {
      return res.json({ success: true, data: { status: user.bvnVerified ? "COMPLETED" : "NOT_STARTED" } });
    }

    const result = await getBvnConsentStatus(user.bvnConsentReference);

    if (result.status !== "COMPLETED") {
      return res.json({ success: true, data: { status: result.status } });
    }

    const bvnData = result.bvn_data || {};

    const updates = {
      bvnVerified: true,
      bvnLast4: bvnData.bvn ? String(bvnData.bvn).slice(-4) : null,
      bvnVerifiedName: `${bvnData.first_name || ""} ${bvnData.last_name || ""}`.trim(),
      bvnDateOfBirth: bvnData.date_of_birth || null,
      bvnConsentReference: null,
    };

    // Flutterwave's BVN consent returns the NIN too - if it matches what the
    // user provided (or if they hadn't provided one), mark it verified.
    if (bvnData.nin) {
      updates.ninVerified = true;
      if (!user.nin) updates.nin = bvnData.nin;
    }

    if (user.kycStatus === "unverified") updates.kycStatus = "pending";

    await User.findByIdAndUpdate(req.user._id, updates);

    return res.json({ success: true, data: { status: "COMPLETED" } });
  } catch (err) {
    console.error("BVN status check failed:", err.response?.data || err.message || err);
    return res.status(502).json({ success: false, message: "Could not check verification status. Try again shortly." });
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

    const identity = validateIdentityFormat({ dateOfBirth, nin });
    if (!identity.ok) {
      return res.status(identity.status).json({ success: false, message: identity.message });
    }

    await User.findByIdAndUpdate(req.user._id, { dateOfBirth, nin });

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
  getBvnStatus,
  completeProfile,
  verifyEmail,
  resendVerification,
};