import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------- GROQ INIT --------------------
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// -------------------- ROOT --------------------
app.get("/", (req, res) => {
  res.send("DeutschFordisch backend is running.");
});

// -------------------- HEALTH --------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
  });
});

// -------------------- DICTIONARY (LIBRETRANSLATE ONLY) --------------------
app.get("/dict", async (req, res) => {
  const { term, from = "de", to = "en" } = req.query;

  if (!term) {
    return res.status(400).json({
      success: false,
      error: "Missing term",
    });
  }

  try {
    const response = await fetch("https://libretranslate.de/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: term,
        source: from,
        target: to,
        format: "text",
      }),
    });

    if (!response.ok) {
      throw new Error("LibreTranslate request failed");
    }

    const data = await response.json();

    if (!data?.translatedText) {
      throw new Error("No translation returned");
    }

    res.json({
      success: true,
      term,
      from,
      to,
      translation: data.translatedText,
      source: "libretranslate",
    });
  } catch (err) {
    console.error("Dictionary error:", err.message);
    res.status(500).json({
      success: false,
      error: "Dictionary service unavailable",
    });
  }
});

// -------------------- AI: SENTENCE GENERATION --------------------
app.get("/sentence", async (req, res) => {
  const { word, level = "A1" } = req.query;

  if (!word) {
    return res.status(400).json({
      success: false,
      error: "Missing word",
    });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a German language tutor. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: `Create a ${level}-level German sentence using the word "${word}".
Return JSON exactly like:
{"german":"...", "english":"..."}`,
        },
      ],
    });

    const output = JSON.parse(
      completion.choices[0].message.content
    );

    res.json({
      success: true,
      ...output,
    });
  } catch (err) {
    console.error("Sentence error:", err.message);
    res.status(500).json({
      success: false,
      error: "AI sentence generation failed",
    });
  }
});

// -------------------- AI: TRANSLATION EVALUATION --------------------
app.post("/evaluate", async (req, res) => {
  const { sentence, translation, level = "A1" } = req.body;

  if (!sentence || !translation) {
    return res.status(400).json({
      success: false,
      error: "Missing sentence or translation",
    });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict but helpful German teacher. Respond only in JSON.",
        },
        {
          role: "user",
          content: `Evaluate this translation for a ${level} learner.

German sentence:
"${sentence}"

User translation:
"${translation}"

Return JSON exactly like:
{"score":85,"feedback":"Short feedback","correct":"Correct translation here"}`,
        },
      ],
    });

    const output = JSON.parse(
      completion.choices[0].message.content
    );

    res.json({
      success: true,
      ...output,
    });
  } catch (err) {
    console.error("Evaluation error:", err.message);
    res.status(500).json({
      success: false,
      error: "AI evaluation failed",
    });
  }
});

// -------------------- START --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
