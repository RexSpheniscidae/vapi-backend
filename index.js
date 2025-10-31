import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";

// Read valid timezones from file
const timezoneFile = path.join(process.cwd(), "timezones.txt");
const VALID_TIMEZONES = fs.readFileSync(timezoneFile, "utf-8")
  .split("\n")
  .map(tz => tz.trim())
  .filter(Boolean);
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

  try {
    // 1️⃣ Extract input fields with defaults
    let { start_time, email, first_name, last_name, timezone } = req.body;

    // 2️⃣ Validate start_time format: expect 'YYYY-MM-DDTHH:mm'
    if (!start_time || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start_time)) {
      return res.status(400).json({
        book_status: "failed",
        message: "Invalid or missing start_time. Expected format: YYYY-MM-DDTHH:mm"
      });
    }

    // 3️⃣ Apply default values if fields are missing
    email = email || "placeholder@gmail.com";
    first_name = first_name || "Placeholder name";
    last_name = last_name || "Placeholder last name";
    timezone = timezone || "America/Los_Angeles";
    if (!VALID_TIMEZONES.includes(timezone)) {
      console.warn(`⚠️ Invalid timezone received: ${timezone}. Defaulting to America/Los_Angeles`);
      timezone = "America/Los_Angeles";
    }

    // 4️⃣ Refresh Calendly access token
    await refreshCalendlyAccessToken();

    // 5️⃣ Parse start_time into ISO string with seconds and timezone
    const startTimeISO = new Date(`${start_time}:00`).toISOString(); // add seconds

    // 6️⃣ Prepare payload for Calendly API
    const payload = {
      event_type: "https://api.calendly.com/event_types/02cc0b90-407e-4009-82e8-0bc33598718d",
      start_time: startTimeISO,
      invitee: { email, first_name, last_name, timezone }
    };

    console.log("➡️ Sending booking payload:", payload);
    
    const response = await fetch("https://api.calendly.com/invitees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();

    // 8️⃣ Check result and respond
    if (response.ok && data?.resource?.uri) {
      console.log("✅ Booking successful:", data.resource.uri);

      return res.status(200).json({
        book_status: "success",
        meeting_uri: data.resource.uri,
        event: data.resource,
        message: "Meeting successfully booked."
      });
    } else {
      console.error("❌ Calendly returned an error:", data);
      return res.status(response.status).json({
        book_status: "failed",
        message: data.message || "Calendly booking failed",
        error: data
      });
    }

  } catch (err) {
    console.error("❌ Booking Error:", err);
    return res.status(500).json({
      book_status: "failed",
      message: "Internal server error while booking",
      error: err.message
    });
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
