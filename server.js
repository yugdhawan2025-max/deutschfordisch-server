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

/* -------------------- GROQ INIT -------------------- */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* -------------------- ROOT: PREMIUM DASHBOARD -------------------- */
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DeutschFordisch Backend</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0c10;
            --glass: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.08);
            --accent: #00d2ff;
            --accent-glow: rgba(0, 210, 255, 0.3);
            --text: #f0f0f0;
            --text-muted: #8a8d91;
            --card-bg: rgba(20, 24, 31, 0.8);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', sans-serif;
            background: radial-gradient(circle at top right, #1a1e2e, #0a0c10);
            color: var(--text);
            line-height: 1.6;
            padding: 2rem;
            min-height: 100vh;
        }
        h1, h2, h3 { font-family: 'Outfit', sans-serif; font-weight: 600; }
        .container { max-width: 1100px; margin: 0 auto; }
        .header { margin-bottom: 4rem; text-align: center; animation: fadeIn 1s ease-out; }
        .header h1 { font-size: 3rem; letter-spacing: -2px; margin-bottom: 0.5rem; background: linear-gradient(to right, #fff, var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .badge { display: inline-block; padding: 0.4rem 1rem; border-radius: 30px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; background: rgba(0, 210, 255, 0.1); color: var(--accent); border: 1px solid var(--accent); margin-bottom: 1.5rem; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; }
        
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: blur(20px);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .card:hover { transform: translateY(-8px); border-color: var(--accent); box-shadow: 0 15px 40px rgba(0, 210, 255, 0.15); }
        .card h3 { margin-bottom: 1.5rem; font-size: 1.4rem; color: #fff; background: rgba(255,255,255,0.05); padding: 0.5rem 1rem; border-radius: 10px; margin-left: -1rem; margin-right: -1rem; margin-top: -1rem; }
        
        .input-group { margin-bottom: 1.5rem; }
        label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.6rem; }
        input, select, textarea {
            width: 100%;
            background: rgba(0,0,0,0.4);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1rem;
            color: #fff;
            font-family: inherit;
            transition: all 0.3s;
            outline: none;
        }
        input:focus, select:focus, textarea:focus { border-color: var(--accent); background: rgba(0, 210, 255, 0.05); }
        
        button {
            width: 100%;
            padding: 1rem;
            border-radius: 12px;
            border: none;
            background: linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%);
            color: white;
            font-weight: 700;
            font-size: 1rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: auto;
        }
        button:hover { transform: scale(1.02); filter: brightness(1.1); box-shadow: 0 5px 20px var(--accent-glow); }
        button:active { transform: scale(0.98); }
        
        .result-container {
            margin-top: 1.5rem;
            border-radius: 12px;
            background: #000;
            padding: 1rem;
            font-family: 'Fira Code', 'Monaco', monospace;
            font-size: 0.85rem;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--border);
            display: none;
            scrollbar-width: thin;
        }
        .result-container.active { display: block; animation: slideIn 0.3s ease-out; }
        .json-key { color: #f97583; }
        .json-string { color: #9ecbff; }
        .json-number { color: #ffab70; }
        
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .status-footer { margin-top: 4rem; text-align: center; font-size: 0.85rem; color: var(--text-muted); opacity: 0.7; }
        .indicator { width: 10px; height: 10px; border-radius: 50%; display: inline-block; background: #00ff88; margin-right: 8px; box-shadow: 0 0 10px #00ff88; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="badge">Production Ready</div>
            <h1>DeutschFordisch API</h1>
            <p>High-performance AI & Dictionary Services for Language Learning</p>
        </div>

        <div class="grid">
            <!-- Dictionary -->
            <div class="card">
                <h3>Dictionary Lookup</h3>
                <div class="input-group">
                    <label>Query</label>
                    <input type="text" id="dict-query" placeholder="e.g., Haus">
                </div>
                <div class="input-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <label>From</label>
                        <select id="dict-from"><option value="de">German</option><option value="en">English</option></select>
                    </div>
                    <div>
                        <label>To</label>
                        <select id="dict-to"><option value="en">English</option><option value="de">German</option></select>
                    </div>
                </div>
                <button onclick="runTest('dict')">Search API</button>
                <div id="dict-res" class="result-container"></div>
            </div>

            <!-- AI Sentence -->
            <div class="card">
                <h3>Sentence Generation</h3>
                <div class="input-group">
                    <label>Keyword</label>
                    <input type="text" id="sent-word" placeholder="e.g., Freiheit">
                </div>
                <div class="input-group">
                    <label>Difficulty</label>
                    <select id="sent-level">
                        <option value="A1">A1 (Beginner)</option>
                        <option value="A2">A2</option>
                        <option value="B1">B1 (Intermediate)</option>
                        <option value="B2">B2</option>
                        <option value="C1">C1 (Complex)</option>
                    </select>
                </div>
                <button onclick="runTest('sentence')">Generate AI</button>
                <div id="sent-res" class="result-container"></div>
            </div>

            <!-- AI Evaluate -->
            <div class="card" style="grid-column: span 1.5">
                <h3>Translation Validator</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div class="input-group">
                        <label>Target Sentence (DE)</label>
                        <textarea id="eval-sent" placeholder="Der Hund schläft." rows="2"></textarea>
                    </div>
                    <div class="input-group">
                        <label>User Translation (EN)</label>
                        <textarea id="eval-user" placeholder="The dog is sleeping." rows="2"></textarea>
                    </div>
                </div>
                <button onclick="runTest('evaluate')">Validate with AI</button>
                <div id="eval-res" class="result-container"></div>
            </div>
        </div>

        <div class="status-footer">
            <span class="indicator"></span> API Version 2.1.0 • Stateless Layer • Stateless Learning
        </div>
    </div>

    <script>
        async function runTest(type) {
            const resDiv = document.getElementById(\`\${type}-res\`);
            resDiv.innerHTML = '<span style="color: var(--accent)">Processing...</span>';
            resDiv.classList.add('active');

            let url = '';
            let method = 'GET';
            let body = null;

            if (type === 'dict') {
                const q = document.getElementById('dict-query').value;
                const f = document.getElementById('dict-from').value;
                const t = document.getElementById('dict-to').value;
                url = \`/dict?term=\${q}&from=\${f}&to=\${t}\`;
            } else if (type === 'sentence') {
                const w = document.getElementById('sent-word').value;
                const l = document.getElementById('sent-level').value;
                url = \`/sentence?word=\${w}&level=\${l}\`;
            } else if (type === 'evaluate') {
                url = '/evaluate';
                method = 'POST';
                body = {
                    sentence: document.getElementById('eval-sent').value,
                    translation: document.getElementById('eval-user').value
                };
            }

            try {
                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: body ? JSON.stringify(body) : null
                });
                const data = await response.json();
                resDiv.innerHTML = \`<pre>\${JSON.stringify(data, null, 2)}</pre>\`;
            } catch (err) {
                resDiv.innerHTML = \`<span style="color: #ff4757">Error: \${err.message}</span>\`;
            }
        }
    </script>
</body>
</html>
  `);
});

/* -------------------- HEALTH -------------------- */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/* -------------------- DICTIONARY (MYMEMORY) -------------------- */
async function handleDict(req, res) {
  const { term, from = "de", to = "en" } = req.method === 'POST' ? req.body : req.query;
  const queryTerm = term || req.body?.word; // Support user's preferred Param name

  if (!queryTerm) {
    return res.status(400).json({ success: false, error: "Missing term" });
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(queryTerm)}&langpair=${from}|${to}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 403 || !data.responseData) {
      throw new Error("Service rate-limit or error");
    }

    const primary = data.responseData.translatedText;
    const matches = data.matches || [];

    res.json({
      success: true,
      term: queryTerm,
      from,
      to,
      primary,
      alternates: matches.slice(1, 5).map(m => m.translation).filter(t => t !== primary),
      source: "mymemory"
    });
  } catch (err) {
    console.error("Dict error:", err.message);
    res.status(500).json({ success: false, error: "Dictionary lookup failed" });
  }
}

app.get("/dict", handleDict);
app.post("/dict", handleDict); // Support for user's POST attempts

/* -------------------- AI: GENERATE SENTENCE -------------------- */
app.get("/sentence", async (req, res) => {
  const { word, level = "A1" } = req.query;

  if (!word) {
    return res.status(400).json({ success: false, error: "Missing word" });
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a professional language tutor. Respond ONLY in valid JSON format." },
        { role: "user", content: `Generate a natural German sentence using the word "${word}" for a ${level} level learner. Include an English translation. Format: {"german": "...", "english": "..."}` }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    res.json({ success: true, ...data });

  } catch (err) {
    console.error("AI Sentence error:", err.message);
    res.status(500).json({ success: false, error: "AI generation failed" });
  }
});

/* -------------------- AI: EVALUATE -------------------- */
app.post("/evaluate", async (req, res) => {
  const { sentence, translation, level = "A1" } = req.body;

  if (!sentence || !translation) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a strict language tutor. Respond ONLY in valid JSON format." },
        { role: "user", content: `Evaluate this translation for a ${level} learner. German: "${sentence}", User Translation: "${translation}". provide a score (0-100), feedback, and the correct translation. Format: {"score": 85, "feedback": "...", "correct": "..."}` }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    res.json({ success: true, ...data });

  } catch (err) {
    console.error("AI Evaluation error:", err.message);
    res.status(500).json({ success: false, error: "AI evaluation failed" });
  }
});

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});