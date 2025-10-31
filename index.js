import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

async function refreshCalendlyAccessToken() {
  console.log("🔄 Refreshing Calendly OAuth token...");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.CALENDLY_REFRESH_TOKEN,
    redirect_uri: process.env.CALENDLY_REDIRECT_URI
  });

  const basic = Buffer.from(
    `${process.env.CALENDLY_CLIENT_ID}:${process.env.CALENDLY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://auth.calendly.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const tokens = await response.json();
  console.log("✅ New Calendly Tokens Received:", tokens);

  // Save new tokens in memory
  process.env.CALENDLY_TOKEN = tokens.access_token;
  process.env.CALENDLY_REFRESH_TOKEN = tokens.refresh_token;
}

// Health check
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// ---------- REAL-TIME AVAILABILITY ----------
app.get("/vapi/get-availability", async (req, res) => {
  console.log("🔹 /vapi/get-availability CALLED");

  await refreshCalendlyAccessToken(); // ✅ Always refresh token before request

  const eventType = "https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d";
  const startTime = new Date().toISOString();
  const endTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const response = await fetch(
      `https://api.calendly.com/event_type_available_times?event_type=${eventType}&start_time=${startTime}&end_time=${endTime}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();
    console.log("✅ Calendly Availability Response:", JSON.stringify(data, null, 2));

    res.json(data.resource?.available_times || []);
  } catch (err) {
    console.error("❌ Availability Error:", err);
    res.status(500).json({ error: "Unable to fetch availability" });
  }
});

// ---------- BOOK A MEETING ----------
app.post("/vapi/book-slot", async (req, res) => {
  console.log("🔹 /vapi/book-slot CALLED");
  console.log("📩 Request Body:", req.body);

  await refreshCalendlyAccessToken(); // ✅ Always refresh token before request

  const { start_time, email, first_name, last_name, timezone } = req.body;

  const payload = {
    event_type: `https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d`,
    start_time,
    invitee: { email, first_name, last_name, timezone }
  };

  try {
    const response = await fetch("https://api.calendly.com/scheduling/event_invitees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("✅ Calendly Booking Response:", JSON.stringify(data, null, 2));

    res.json(data);
  } catch (err) {
    console.error("❌ Booking Error:", err);
    res.status(500).json({ error: "Failed to book meeting" });
  }
});

// ---------- Calendly OAuth Flow ----------
app.get("/oauth/calendly/start", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.CALENDLY_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.CALENDLY_REDIRECT_URI
  });
  res.redirect(`https://auth.calendly.com/oauth/authorize?${params.toString()}`);
});

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

    res.send("✅ Calendly Connected! You can close this window.");
  } catch (err) {
    console.error("❌ OAuth Error:", err);
    res.status(500).send("OAuth failed");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
