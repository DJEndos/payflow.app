require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const billRoutes = require("./routes/billRoutes");
const userRoutes = require("./routes/userRoutes");
const { paystackWebhook } = require("./controllers/walletController");

connectDB();

const app = express();

const allowedOrigins = [process.env.FRONTEND_URL, "http://localhost:5500", "https://payflow-app-omega.vercel.app"]
  .concat((process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(morgan("dev"));

// Webhook must read the raw JSON body BEFORE express.json() parses it away,
// so Paystack's signature can be verified against the EXACT bytes sent.
app.post(
  "/api/wallet/fund/webhook",
  express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }),
  paystackWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic rate limiting on auth routes to slow down brute-force attempts
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use("/api/auth", authLimiter, authRoutes);

app.use("/api/wallet", walletRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/user", userRoutes);

app.get("/", (req, res) => res.json({ status: "PayFlow API running" }));
app.use((req, res) => res.status(404).json({ success: false, message: "Not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`PayFlow API running on port ${PORT}`));
