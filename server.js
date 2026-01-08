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
        
        .input-group { margin-bottom: 1.5rem; position: relative; }
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
        
        /* Language Toggle Switch */
        .toggle-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 1.5rem;
            background: rgba(0,0,0,0.4);
            padding: 0.8rem 1.5rem;
            border-radius: 50px;
            border: 1px solid var(--border);
            margin-bottom: 1.5rem;
            user-select: none;
        }
        .lang-label { font-weight: 600; font-size: 0.9rem; color: var(--text-muted); transition: color 0.3s; }
        .lang-label.active { color: var(--accent); text-shadow: 0 0 10px var(--accent-glow); }
        
        .switch {
            position: relative;
            display: inline-block;
            width: 54px;
            height: 28px;
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #2a2d3e;
            transition: .4s;
            border-radius: 34px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 20px;
            width: 20px;
            left: 4px;
            bottom: 4px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        }
        input:checked + .slider { background-color: var(--accent); }
        input:checked + .slider:before { transform: translateX(26px); }

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
                
                <div class="toggle-wrapper" title="Switch Translation Direction">
                    <span id="dict-label-de" class="lang-label active">DE</span>
                    <label class="switch">
                        <input type="checkbox" id="dict-toggle" onchange="updateToggle('dict')">
                        <span class="slider"></span>
                    </label>
                    <span id="dict-label-en" class="lang-label">EN</span>
                </div>

                <div class="input-group">
                    <label id="dict-query-label">German Word</label>
                    <input type="text" id="dict-query" placeholder="e.g., Haus">
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
                <div id="sentence-res" class="result-container"></div>
            </div>

            <div class="card" style="grid-column: span 1.5">
                <h3>Translation Validator</h3>
                
                <div class="toggle-wrapper" style="width: fit-content; margin-inline: auto;">
                    <span id="eval-label-de" class="lang-label active">DE → EN</span>
                    <label class="switch">
                        <input type="checkbox" id="eval-toggle" onchange="updateToggle('eval')">
                        <span class="slider"></span>
                    </label>
                    <span id="eval-label-en" class="lang-label">EN → DE</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div class="input-group">
                        <label id="label-sentence">Source Sentence (DE)</label>
                        <textarea id="eval-sent" placeholder="Der Hund schläft." rows="2"></textarea>
                    </div>
                    <div class="input-group">
                        <label id="label-translation">User Translation (EN)</label>
                        <textarea id="eval-user" placeholder="The dog is sleeping." rows="2"></textarea>
                    </div>
                </div>
                <button onclick="runTest('evaluate')">Validate with AI</button>
                <div id="evaluate-res" class="result-container"></div>
            </div>
        </div>

        <div class="status-footer">
            <span class="indicator"></span> API Version 2.1.0 • Stateless Layer • AI Refinement Active
        </div>
    </div>

    <script>
        function updateToggle(type) {
            const isChecked = document.getElementById(\`\${type}-toggle\`).checked;
            if (type === 'dict') {
                const labelDe = document.getElementById('dict-label-de');
                const labelEn = document.getElementById('dict-label-en');
                const queryLabel = document.getElementById('dict-query-label');
                const queryInput = document.getElementById('dict-query');
                
                if (isChecked) {
                    labelDe.classList.remove('active');
                    labelEn.classList.add('active');
                    queryLabel.innerText = "English Word";
                    queryInput.placeholder = "e.g., House";
                } else {
                    labelDe.classList.add('active');
                    labelEn.classList.remove('active');
                    queryLabel.innerText = "German Word";
                    queryInput.placeholder = "e.g., Haus";
                }
            } else if (type === 'eval') {
                const labelDe = document.getElementById('eval-label-de');
                const labelEn = document.getElementById('eval-label-en');
                const labelSent = document.getElementById('label-sentence');
                const areaSent = document.getElementById('eval-sent');
                const labelUser = document.getElementById('label-translation');
                const areaUser = document.getElementById('eval-user');

                if (isChecked) {
                    labelDe.classList.remove('active');
                    labelEn.classList.add('active');
                    labelSent.innerText = "Source Sentence (EN)";
                    areaSent.placeholder = "The dog is sleeping.";
                    labelUser.innerText = "User Translation (DE)";
                    areaUser.placeholder = "Der Hund schläft.";
                } else {
                    labelDe.classList.add('active');
                    labelEn.classList.remove('active');
                    labelSent.innerText = "Source Sentence (DE)";
                    areaSent.placeholder = "Der Hund schläft.";
                    labelUser.innerText = "User Translation (EN)";
                    areaUser.placeholder = "The dog is sleeping.";
                }
            }
        }

        async function runTest(type) {
            const resDiv = document.getElementById(\`\${type}-res\`);
            if (!resDiv) return console.error("Result div not found for type: " + type);
            resDiv.innerHTML = '<span style="color: var(--accent)">Processing...</span>';
            resDiv.classList.add('active');

            let url = '';
            let method = 'GET';
            let body = null;

            if (type === 'dict') {
                const q = document.getElementById('dict-query').value;
                const isEnToDe = document.getElementById('dict-toggle').checked;
                const f = isEnToDe ? "en" : "de";
                const t = isEnToDe ? "de" : "en";
                url = \`/dict?term=\${q}&from=\${f}&to=\${t}\`;
            } else if (type === 'sentence') {
                const w = document.getElementById('sent-word').value;
                const l = document.getElementById('sent-level').value;
                url = \`/sentence?word=\${w}&level=\${l}\`;
            } else if (type === 'evaluate') {
                url = '/evaluate';
                method = 'POST';
                const isEnToDe = document.getElementById('eval-toggle').checked;
                body = {
                    sentence: document.getElementById('eval-sent').value,
                    translation: document.getElementById('eval-user').value,
                    from: isEnToDe ? "en" : "de",
                    to: isEnToDe ? "de" : "en",
                    level: "A1"
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

app.get("/test-ai", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { background: #111; color: #fff; font-family: sans-serif; text-align: center; padding: 20px; }
button { padding: 15px 30px; font-size: 18px; background: #00d2ff; border: none; border-radius: 8px; cursor: pointer; }
#log { margin-top: 20px; font-family: monospace; color: #0f0; }
</style>
</head>
<body>
<h1>AI Speed Test</h1>
<button onclick="testSpeed()">Run Test</button>
<div id="log"></div>
<script>
async function testSpeed() {
    const log = document.getElementById('log');
    log.innerHTML = "Testing...";
    const start = Date.now();
    try {
        const res = await fetch('/sentence?word=test&level=A1');
        const data = await res.json();
        const end = Date.now();
        const duration = (end - start) / 1000;
        log.innerHTML = \`Success!\nTime: \${duration}s\n\nResponse:\n\${JSON.stringify(data, null, 2)}\`;
    } catch (e) {
        log.innerHTML = "Error: " + e.message;
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

    let primary = data.responseData.translatedText;
    const matches = data.matches || [];
    let filteredAlternates = []; // Declare filteredAlternates here

    // --- UNIVERSAL EN <-> DE ENHANCEMENT (AI Refinement) ---
    // Single-word refinement using a world-class model for accuracy & direction correction
    const isSingleWord = !queryTerm.trim().includes(" ");

    if (isSingleWord) {
      try {
        const refinement = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a world-class German-English linguist. You are tasked with providing the perfect translation for the word '${queryTerm}'.
Response MUST be valid JSON:
{
  "primary": "refined translation",
  "alternates": ["alt1", "alt2", "alt3"]
}

Direction Rules:
1. SMART DIRECTION: If the user sends an English word but asks for 'to=en', they made a MISTAKE. You MUST translate it to German instead.
2. SMART DIRECTION: If the user sends a German word but asks for 'to=de', they made a MISTAKE. You MUST translate it to English instead.
3. If the final result is German:
   - For NOUNS: 'primary' MUST start with its definite article (der, die, das).
   - For ADJECTIVES/VERBS: 'primary' SHOULD include two distinct meanings (e.g., 'schnell, rasch').
4. If the final result is English:
   - Provide the most common translation.
5. 'alternates' MUST be strictly relevant synonyms in the same language as 'primary'.`
            },
            { role: "user", content: `Translate '${queryTerm}' (Requested from: ${from}, to: ${to}). Initial suggestion: ${primary}` }
          ],
          model: "llama-3.3-70b-versatile",
          response_format: { type: "json_object" }
        });

        const aiData = JSON.parse(refinement.choices[0]?.message?.content || "{}");
        if (aiData.primary) {
          primary = aiData.primary;
          filteredAlternates = aiData.alternates || [];
        }
      } catch (e) {
        console.error("AI Refinement failed:", e.message);
      }
    } else {
      // Original filtering logic for sentences/phrases
      filteredAlternates = matches
        .slice(1, 15)
        .map(m => m.translation)
        .filter(t => t && t !== primary)
        .filter(t => {
          const cleanT = t.trim();
          return cleanT.length < queryTerm.length * 2.5;
        })
        .slice(0, 5);
    }

    res.json({
      success: true,
      term: queryTerm,
      from,
      to,
      primary,
      alternates: filteredAlternates,
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
  const { word, term, level = "A1" } = req.query;
  const queryWord = word || term;

  if (!queryWord) {
    return res.status(400).json({ success: false, error: "Missing word/term" });
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a professional language tutor. Respond ONLY in valid JSON format." },
        { role: "user", content: `Generate a natural German sentence using the word "${queryWord}" for a ${level} level learner. Include an English translation. Format: {"german": "...", "english": "..."}` }
      ],
      model: "llama-3.1-8b-instant", // Optimized for speed (prevent timeouts)
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    // Wrap in "data" key for Flutter, while keeping flat keys for backward compatibility
    res.json({
      success: true,
      word: queryWord,
      data,
      ...data
    });

  } catch (err) {
    console.error("AI Sentence error:", err.message);
    res.status(500).json({ success: false, error: "AI generation failed" });
  }
});

/* -------------------- AI: LEARNING MODE (PRACTICE) -------------------- */
app.get("/learn/practice", async (req, res) => {
  const { type = "en-de", level = "A1" } = req.query; // type: 'en-de' (written) or 'de-en' (mcq)

  try {
    let systemPrompt = "You are a professional language tutor. Respond ONLY in valid JSON format.";
    let userPrompt = "";

    if (type === "en-de") {
      // MODE 1: Written Translation (EN -> DE)
      // User gets an English sentence, translates it to German (validated later by /evaluate)
      userPrompt = `Generate a level-appropriate English sentence for a ${level} CEFR German learner to translate.

Level Guidelines:
- A1: Simple present tense, basic vocabulary (family, food, colors). Max 5 words.
- A2: Present/past tense, everyday topics. Max 8 words.
- B1: Multiple tenses, common idioms, longer sentences. Max 12 words.
- B2: Complex grammar (subjunctive, passive), abstract topics. Max 15 words.
- C1/C2: Advanced structures, nuanced vocabulary, literary style.

Format: {"question": "English sentence (Sentence case)", "context": "Brief English grammar hint (e.g., 'Use Perfekt tense')"}`;
    } else {
      // MODE 2: MCQ (DE -> EN)
      // User gets a German sentence, chooses right English meaning from 4 options
      userPrompt = `Generate a level-appropriate German sentence for a ${level} CEFR learner with 4 English MCQ options.

Level Guidelines:
- A1: Basic vocabulary, simple present. Example: "Der Hund ist groß."
- A2: Common verbs, past tense. Example: "Ich habe gestern Fußball gespielt."
- B1: Modal verbs, subordinate clauses. Example: "Obwohl es regnet, gehe ich spazieren."
- B2: Subjunctive, passive voice. Example: "Das Buch wurde von einem berühmten Autor geschrieben."
- C1/C2: Idiomatic expressions, complex syntax.

Format: {
  "question": "German sentence (Sentence case)",
  "options": ["Option A (English)", "Option B (English)", "Option C (English)", "Option D (English)"],
  "answer": "The correct option string (English)",
  "explanation": "Standardized format: 'Correct! The sentence uses [grammar point] because [reason].' (Max 2 sentences, English only)"
}`;
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile", // Upgraded to 70b for professional consistency
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");

    res.json({
      success: true,
      type,
      level,
      data,
      ...data
    });

  } catch (err) {
    console.error("AI Learn error:", err.message);
    res.status(500).json({ success: false, error: "Learning generation failed" });
  }
});

/* -------------------- AI: EVALUATE TRANSLATION -------------------- */
app.post("/evaluate", async (req, res) => {
  const { sentence, translation, level = "A1", from = "de", to = "en" } = req.body;

  if (!sentence || !translation) {
    return res.status(400).json({ success: false, error: "Missing sentence or translation" });
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a strict German grammar expert. You MUST follow all German grammar rules perfectly. Respond ONLY in valid JSON." },
        {
          role: "user", content: `Evaluate this ${level} CEFR learner's translation.

Original (${from === 'de' ? 'German' : 'English'}): "${sentence}"
User's Translation (${to === 'en' ? 'English' : 'German'}): "${translation}"

CRITICAL GERMAN GRAMMAR RULES (NEVER VIOLATE):
- Akkusativ (direct object): der→den, ein→einen (masc), das→das, ein→ein (neut), die→die, eine→eine (fem)
- Example: "Ich esse einen Apfel" (NOT "ein Apfel" - Apfel is masculine accusative!)
- Dativ (indirect object): der→dem, ein→einem (masc), das→dem, ein→einem (neut), die→der, eine→einer (fem)
- Verb conjugation: ich esse, du isst, er/sie/es isst, wir essen, ihr esst, sie essen
- Word order: Subject-Verb-Object in main clauses

Provide concise, encouraging feedback IN ENGLISH:
1. user_answer: Echo back exactly what they wrote.
2. corrected_answer: The GRAMMATICALLY PERFECT translation for ${level} level. Double-check all cases and articles!
3. feedback: 2-3 sentences max in English. If wrong, explain the SPECIFIC grammar rule violated in English (e.g., "Apfel is masculine, so accusative is 'einen', not 'ein'").
4. b2_reference_answer: Advanced B2 translation (only if different).

Return JSON: {
  "user_answer": "${translation}",
  "corrected_answer": "Grammatically perfect ${level} translation",
  "feedback": "Brief English feedback with specific grammar rule",
  "b2_reference_answer": "Advanced B2 translation"
}` }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    res.json({
      success: true,
      data,
      ...data
    });

  } catch (err) {
    console.error("AI Evaluation error:", err.message);
    res.status(500).json({ success: false, error: "AI evaluation failed" });
  }
});

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`Server live on port ${PORT} `);
});