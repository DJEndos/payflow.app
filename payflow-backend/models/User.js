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

    // Required for NEW registrations (enforced in the register() controller,
    // not here) - but NOT required at the schema level, because existing
    // users registered before this feature don't have these fields, and a
    // schema-level `required: true` would throw a ValidationError the next
    // time ANY .save() touches their document (setting a PIN, sending a
    // transfer, buying a bill - anything). Existing users see a "complete
    // your profile" prompt instead of getting silently locked out.
    dateOfBirth: { type: Date, default: null },
    // NIN itself is sensitive too, but unlike BVN it's commonly required to be
    // shown back to the user (e.g. on printed KYC forms), so we store it
    // encrypted-at-rest by MongoDB Atlas default disk encryption rather than
    // masking it outright. Never log it or return it in API responses.
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
