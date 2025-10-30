import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

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
