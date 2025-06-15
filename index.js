import express from "express";
import dotenv from "dotenv";
import { checkInbox } from "./services/imapService.js";

dotenv.config();

const app = express();

app.get("/check-inbox", async (req, res) => {
  try {
    const mails = await checkInbox();
    res.json({ success: true, mails });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});
