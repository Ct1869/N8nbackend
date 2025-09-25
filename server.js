// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

/* ------------------------- Middleware ------------------------- */
app.use(express.json());

// Configure CORS: allow your frontend and optionally others via env var
const DEFAULT_ALLOWED_ORIGINS = [
  "https://kingof-gray.vercel.app",     // your frontend
  "https://kingo-fbackend.vercel.app"   // your backend (optional, for self-calls)
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS
);

app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, server-to-server) with no Origin
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

/* ---------------------- MongoDB connection -------------------- */
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set. Add it in your Vercel project → Settings → Environment Variables.");
  // Exit early in non-serverless env to avoid hanging
  if (require.main === module) process.exit(1);
}

// Connect (Mongoose queues operations until connected)
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, { autoIndex: true })
    .catch(err => {
      console.error("❌ Initial MongoDB connection error:", err);
      if (require.main === module) process.exit(1);
    });
}

/* --------------------- Schema & Model ------------------------- */
const phoneSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    mode: { type: String, enum: ["CALL", "OTP"], default: "CALL" },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

const PhoneMode = mongoose.model("PhoneMode", phoneSchema);

/* ---------------------- Initial seeding ------------------------ */
const seedNumbers = [
  { number: "+17753055823", mode: "CALL" },
  { number: "+16693454835", mode: "CALL" },
  { number: "+19188183039", mode: "CALL" },
  { number: "+15088127382", mode: "CALL" },
  { number: "+18722965039", mode: "CALL" },
  { number: "+14172218933", mode: "CALL" },
  { number: "+19191919191", mode: "OTP" }, // your custom OTP number
];

async function seedDB() {
  try {
    for (const num of seedNumbers) {
      await PhoneMode.updateOne(
        { number: num.number },
        { $set: { mode: num.mode } },
        { upsert: true }
      );
    }
    console.log("✅ Numbers initialized in database");
  } catch (err) {
    console.error("❌ Error seeding DB:", err);
  }
}

// Seed after a successful DB connection
mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB connected successfully");
  seedDB();
});
mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});
mongoose.connection.on("disconnected", () => {
  console.log("⚠️ MongoDB disconnected");
});

/* ------------------------- Helpers ---------------------------- */
function normalize(num) {
  return (num || "").toString().trim();
}

/* ----------------------- API Endpoints ------------------------ */

// Simple root for sanity check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "phone-manager-api", time: new Date().toISOString() });
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // This will throw if not connected
    await mongoose.connection.db.admin().ping();
    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Health check failed:", err);
    res.status(500).json({
      status: "unhealthy",
      database: "disconnected",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Original lookup endpoint (single number)
app.post("/lookup", async (req, res) => {
  try {
    const rawCalled = req.body.Called || req.query.Called;
    const rawTo = req.body.To || req.query.To;
    const calledNumber = normalize(rawCalled || rawTo);

    console.log("DEBUG raw Called:", rawCalled);
    console.log("DEBUG raw To:", rawTo);
    console.log("DEBUG normalized calledNumber:", calledNumber);

    const found = await PhoneMode.findOne({ number: calledNumber });

    res.json({
      calledNumber,
      mode: found ? found.mode : "UNKNOWN",
      from: req.body.From || req.query.From,
      callSid: req.body.CallSid || req.query.CallSid,
    });
  } catch (err) {
    console.error("❌ Error in lookup:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all numbers in database
app.get("/numbers", async (req, res) => {
  try {
    const allNumbers = await PhoneMode.find().sort({ createdAt: -1 });
    res.json(allNumbers);
  } catch (err) {
    console.error("❌ Error fetching numbers:", err);
    res.status(500).json({ error: "Failed to fetch numbers" });
  }
});

// Add new number endpoint
app.post("/add-number", async (req, res) => {
  try {
    const { number, mode } = req.body;

    if (!number || !mode) {
      return res.status(400).json({ error: "Number and mode are required" });
    }

    const normalizedNumber = normalize(number);

    if (!normalizedNumber) {
      return res.status(400).json({ error: "Invalid number format" });
    }

    if (!["CALL", "OTP"].includes(mode)) {
      return res.status(400).json({ error: "Mode must be CALL or OTP" });
    }

    const existing = await PhoneMode.findOne({ number: normalizedNumber });
    if (existing) {
      return res.status(400).json({ error: "Number already exists" });
    }

    const newNumber = new PhoneMode({
      number: normalizedNumber,
      mode,
    });

    const saved = await newNumber.save();

    console.log("✅ Number added:", saved.number, "Mode:", saved.mode);

    res.json({
      success: true,
      message: "Number added successfully",
      data: saved,
    });
  } catch (err) {
    console.error("❌ Error adding number:", err);

    if (err.code === 11000) {
      return res.status(400).json({ error: "Number already exists" });
    }

    res.status(500).json({ error: "Failed to add number" });
  }
});

// Update mode endpoint
app.put("/update-mode", async (req, res) => {
  try {
    const { id, mode } = req.body;

    if (!id || !mode) {
      return res.status(400).json({ error: "ID and mode are required" });
    }

    if (!["CALL", "OTP"].includes(mode)) {
      return res.status(400).json({ error: "Mode must be CALL or OTP" });
    }

    const updated = await PhoneMode.findByIdAndUpdate(
      id,
      { mode },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Number not found" });
    }

    console.log("✅ Mode updated:", updated.number, "New mode:", updated.mode);

    res.json({
      success: true,
      message: "Mode updated successfully",
      data: updated,
    });
  } catch (err) {
    console.error("❌ Error updating mode:", err);
    res.status(500).json({ error: "Failed to update mode" });
  }
});

// Delete number endpoint
app.delete("/delete-number/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "ID is required" });
    }

    const deleted = await PhoneMode.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Number not found" });
    }

    console.log("✅ Number deleted:", deleted.number);

    res.json({
      success: true,
      message: "Number deleted successfully",
      data: deleted,
    });
  } catch (err) {
    console.error("❌ Error deleting number:", err);
    res.status(500).json({ error: "Failed to delete number" });
  }
});

// Get statistics endpoint
app.get("/stats", async (req, res) => {
  try {
    const total = await PhoneMode.countDocuments();
    const callCount = await PhoneMode.countDocuments({ mode: "CALL" });
    const otpCount = await PhoneMode.countDocuments({ mode: "OTP" });

    res.json({
      total,
      call: callCount,
      otp: otpCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Bulk add numbers endpoint
app.post("/bulk-add", async (req, res) => {
  try {
    const { numbers } = req.body;

    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: "Numbers array is required" });
    }

    const results = {
      added: [],
      errors: [],
      skipped: [],
    };

    for (const item of numbers) {
      try {
        const { nu
