import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import dictcc from "dictcc-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* -------------------- HEALTH -------------------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/* -------------------- DICT.CC -------------------- */
/*
GET /dict?term=house&from=en&to=de
*/
app.get("/dict", async (req, res) => {
  const { term, from = "en", to = "de" } = req.query;

  if (!term) {
    return res.status(400).json({
      success: false,
      error: "Missing search term"
    });
  }

  try {
    const result = await dictcc.translate(term, from, to);

    if (!result || result.length === 0) {
      return res.json({
        success: true,
        term,
        results: []
      });
    }

    // Clean + simplify results
    const cleaned = result.map(r => ({
      from: r.from.replace(/\{.*?\}/g, "").trim(),
      to: r.to.replace(/\{.*?\}/g, "").trim(),
      score: r.score || 0
    }));

    res.json({
      success: true,
      term,
      from,
      to,
      primary: cleaned.slice(0, 3),
      all: cleaned
    });

  } catch (err) {
    console.error("DICT ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Dictionary lookup failed"
    });
  }
});

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
