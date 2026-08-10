const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    pin: { type: String, default: null }, // 4-digit transaction PIN, hashed
    accountNumber: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, trim: true, default: "" },
    walletBalance: { type: Number, default: 0, min: 0 },
    isVerified: { type: Boolean, default: false },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    // BVN verification: we deliberately never persist the raw BVN. Only a
    // masked reference plus the verified name/DOB the vendor returned.
    bvnVerified: { type: Boolean, default: false },
    bvnLast4: { type: String, default: null },
    bvnVerifiedName: { type: String, default: null },
    bvnDateOfBirth: { type: String, default: null },
    // Set while a Flutterwave BVN consent verification is in progress
    // (customer redirected to NIBSS's portal), cleared once resolved.
    bvnConsentReference: { type: String, default: null },

    dateOfBirth: { type: Date, default: null },
    
    nin: { type: String, trim: true, default: null },
    ninVerified: { type: Boolean, default: false },

    kycStatus: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },
    kycDocuments: [
      {
        type: { type: String }, // e.g. "government_id", "proof_of_address"
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    kycRejectionReason: { type: String, default: null },

    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.setPin = async function (pin) {
  this.pin = await bcrypt.hash(pin, 10);
};

userSchema.methods.comparePin = function (candidatePin) {
  if (!this.pin) return false;
  return bcrypt.compare(candidatePin, this.pin);
};

module.exports = mongoose.model("User", userSchema);
