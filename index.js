import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

async function updateRenderEnvVariable(name, value) {
  const serviceId = process.env.RENDER_SERVICE_ID; // добавь в .env
  const apiKey = process.env.RENDER_API_KEY;

  if (!serviceId || !apiKey) {
    console.warn("⚠️ Missing Render credentials, skipping env update");
    return;
  }

  console.log(`🔁 Updating ${name} in Render Environment...`);

  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars/CALENDLY_REFRESH_TOKEN`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: value
    }),
  });

  if (!response.ok) {
    console.error(`❌ Failed to update Render env var: ${response.status}, new_token: ${value}`, await response.text());
  } else {
    console.log(`✅ Updated ${name} in Render`);
  }
}


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
  if (tokens.refresh_token) {
    process.env.CALENDLY_REFRESH_TOKEN = tokens.refresh_token;
    await updateRenderEnvVariable("CALENDLY_REFRESH_TOKEN", tokens.refresh_token);
  }
}

// Health check
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// ---------- REAL-TIME AVAILABILITY ----------
app.get("/vapi/get-availability", async (req, res) => {
  console.log("🔹 /vapi/get-availability CALLED");

  await refreshCalendlyAccessToken();

  const eventType = "https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d";

  // ✅ Round current time forward slightly to avoid microsecond boundary issues
  const startTime = new Date(Date.now() + 60 * 1000).toISOString(); // +1 minute
  const endTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days out

  console.log("➡️ Requesting Calendly Availability:", { startTime, endTime });

  try {
    const url = new URL("https://api.calendly.com/event_type_available_times");
    url.searchParams.set("event_type", eventType);
    url.searchParams.set("start_time", startTime);
    url.searchParams.set("end_time", endTime);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

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
