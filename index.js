import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Verify Vapi Shared Secret (protects your booking + availability endpoints)
app.use((req, res, next) => {
  const auth = req.headers["x-vapi-secret"];
  if (!auth || auth !== process.env.VAPI_SHARED_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});

app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ---------- REAL-TIME AVAILABILITY ----------
app.get("/vapi/get-availability", async (req, res) => {
  const eventType = "https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d";

  const startTime = req.query.start || new Date().toISOString(); // Now
  const endTime = req.query.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 days

  try {
    const response = await fetch(
      `https://api.calendly.com/event_type_available_times?event_type=${eventType}&start_time=${startTime}&end_time=${endTime}`,
      { headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}` } }
    );

    const data = await response.json();
    res.json(data.resource?.available_times || []);
  } catch (err) {
    console.error("Availability error:", err);
    res.status(500).json({ error: "Unable to fetch availability" });
  }
});


// ---------- BOOK A MEETING ----------
app.post("/vapi/book-slot", async (req, res) => {
  const { start_time, email, first_name, last_name, timezone } = req.body;

  try {
    const response = await fetch("https://api.calendly.com/scheduling/event_invitees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: `https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d`,
        start_time,
        invitee: { email, first_name, last_name, timezone }
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ error: "Unable to book meeting" });
  }
});
// === Calendly OAuth: Start Flow ===
app.get("/oauth/calendly/start", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.CALENDLY_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.CALENDLY_REDIRECT_URI
  });
  res.redirect(`https://auth.calendly.com/oauth/authorize?${params.toString()}`);
});

// === Calendly OAuth: Callback ===
app.get("/oauth/calendly/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.CALENDLY_REDIRECT_URI
    });

    const authHeader = Buffer.from(
      `${process.env.CALENDLY_CLIENT_ID}:${process.env.CALENDLY_CLIENT_SECRET}`
    ).toString("base64");

    const r = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`
      },
      body
    });

    const tokens = await r.json();
    console.log("✅ Calendly OAuth Success:", tokens);

    // You will later save tokens permanently (database). For now:
    res.send("✅ Calendly Connected! You can close this window.");
  } catch (err) {
    console.error("❌ OAuth Error:", err);
    res.status(500).send("OAuth failed");
  }
});
// === GET AVAILABLE TIME SLOTS (Real-Time) ===
app.get("/vapi/get-availability", async (req, res) => {
  const eventType = "https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d";

  const startTime = new Date().toISOString(); // Now
  const endTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days out

  try {
    const response = await fetch(
      `https://api.calendly.com/event_type_available_times?event_type=${eventType}&start_time=${startTime}&end_time=${endTime}`,
      {
        headers: { Authorization: `Bearer ${process.env.CALENDLY_OAUTH_ACCESS_TOKEN}` }
      }
    );

    const data = await response.json();
    const slots = data.resource?.available_times || [];
    res.json(slots);
  } catch (err) {
    console.error("Availability Error:", err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});


// === BOOK A MEETING ===
app.post("/vapi/book-slot", async (req, res) => {
  const { start_time, email, first_name, last_name, timezone } = req.body;

  try {
    const response = await fetch("https://api.calendly.com/scheduling/event_invitees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_OAUTH_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: `https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d`,
        start_time,
        invitee: { email, first_name, last_name, timezone }
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Booking Error:", err);
    res.status(500).json({ error: "Failed to book meeting" });
  }
});
