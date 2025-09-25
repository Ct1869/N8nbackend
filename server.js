// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

/* ------------------------- Middleware ------------------------- */
app.use(express.json());

// Configure CORS
const DEFAULT_ALLOWED_ORIGINS = [
  "https://kingof-gray.vercel.app",     // frontend
  "https://kingo-fbackend.vercel.app"   // backend (optional)
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS
);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

/* ---------------------- MongoDB connection -------------------- */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set");
  if (require.main === module) process.exit(1);
}
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, { autoIndex: true }).catch(err => {
    console.error("❌ Initial MongoDB connection error:", err);
    if (require.main === module) process.exit(1);
  });
}

/* --------------------- Schema & Model ------------------------- */
const phoneSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  mode: { type: String, enum: ["CALL", "OTP"], default: "CALL" },
}, { timestamps: true });

const PhoneMode = mongoose.model("PhoneMode", phoneSchema);

/* ---------------------- Initial seeding ------------------------ */
const seedNumbers = [
  { number: "+17753055823", mode: "CALL" },
  { number: "+16693454835", mode: "CALL" },
  { number: "+19188183039", mode: "CALL" },
  { number: "+15088127382", mode: "CALL" },
  { number: "+18722965039", mode: "CALL" },
  { number: "+14172218933", mode: "CALL" },
  { number: "+19191919191", mode: "OTP" }
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
    console.log("✅ Numbers initialized");
  } catch (err) {
    console.error("❌ Error seeding DB:", err);
  }
}
mongoose.connection.on("connected", () => { console.log("✅ MongoDB connected"); seedDB(); });
mongoose.connection.on("error", err => console.error("❌ MongoDB error:", err));
mongoose.connection.on("disconnected", () => console.log("⚠️ MongoDB disconnected"));

/* ------------------------- Helpers ---------------------------- */
const normalize = num => (num || "").toString().trim();

/* ----------------------- API Endpoints ------------------------ */
app.get("/", (req, res) => res.json({ ok: true, service: "phone-manager-api", time: new Date().toISOString() }));

app.get("/health", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: "healthy", database: "connected", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", database: "disconnected", error: err.message, timestamp: new Date().toISOString() });
  }
});

app.post("/lookup", async (req, res) => {
  try {
    const rawCalled = req.body.Called || req.query.Called;
    const rawTo = req.body.To || req.query.To;
    const calledNumber = normalize(rawCalled || rawTo);
    const found = await PhoneMode.findOne({ number: calledNumber });
    res.json({
      calledNumber,
      mode: found ? found.mode : "UNKNOWN",
      from: req.body.From || req.query.From,
      callSid: req.body.CallSid || req.query.CallSid,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/numbers", async (req, res) => {
  try {
    const allNumbers = await PhoneMode.find().sort({ createdAt: -1 });
    res.json(allNumbers);
  } catch {
    res.status(500).json({ error: "Failed to fetch numbers" });
  }
});

app.post("/add-number", async (req, res) => {
  try {
    const { number, mode } = req.body;
    if (!number || !mode) return res.status(400).json({ error: "Number and mode are required" });
    const normalizedNumber = normalize(number);
    if (!["CALL", "OTP"].includes(mode)) return res.status(400).json({ error: "Mode must be CALL or OTP" });
    if (await PhoneMode.findOne({ number: normalizedNumber })) return res.status(400).json({ error: "Number already exists" });
    const saved = await new PhoneMode({ number: normalizedNumber, mode }).save();
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ error: "Failed to add number" });
  }
});

app.put("/update-mode", async (req, res) => {
  try {
    const { id, mode } = req.body;
    if (!id || !mode) return res.status(400).json({ error: "ID and mode are required" });
    if (!["CALL", "OTP"].includes(mode)) return res.status(400).json({ error: "Mode must be CALL or OTP" });
    const updated = await PhoneMode.findByIdAndUpdate(id, { mode }, { new: true });
    if (!updated) return res.status(404).json({ error: "Number not found" });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ error: "Failed to update mode" });
  }
});

app.delete("/delete-number/:id", async (req, res) => {
  try {
    const deleted = await PhoneMode.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Number not found" });
    res.json({ success: true, data: deleted });
  } catch {
    res.status(500).json({ error: "Failed to delete number" });
  }
});

app.get("/stats", async (req, res) => {
  try {
    const total = await PhoneMode.countDocuments();
    const callCount = await PhoneMode.countDocuments({ mode: "CALL" });
    const otpCount = await PhoneMode.countDocuments({ mode: "OTP" });
    res.json({ total, call: callCount, otp: otpCount, timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.post("/bulk-add", async (req, res) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers)) return res.status(400).json({ error: "Numbers array required" });
    const results = { added: [], errors: [], skipped: [] };
    for (const item of numbers) {
      try {
        const normalizedNumber = normalize(item.number);
        if (!normalizedNumber) { results.errors.push({ number: item.number, error: "Invalid" }); continue; }
        if (!["CALL", "OTP"].includes(item.mode)) { results.errors.push({ number: item.number, error: "Invalid mode" }); continue; }
        if (await PhoneMode.findOne({ number: normalizedNumber })) { results.skipped.push({ number: normalizedNumber, reason: "Exists" }); continue; }
        const saved = await new PhoneMode({ number: normalizedNumber, mode: item.mode || "CALL" }).save();
        results.added.push(saved);
      } catch (err) { results.errors.push({ number: item.number, error: err.message }); }
    }
    res.json({ success: true, results });
  } catch {
    res.status(500).json({ error: "Bulk add failed" });
  }
});

/* -------------------- Global error handler -------------------- */
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* --------------------- Graceful shutdown ---------------------- */
process.on("SIGINT", async () => {
  console.log("⚠️ SIGINT received, closing DB...");
  try { await mongoose.connection.close(); } finally { process.exit(0); }
});

/* --------------- Export for Vercel / Local run ---------------- */
module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Local server at http://localhost:${PORT}`));
}
