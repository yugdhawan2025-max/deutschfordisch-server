import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* -------------------- GROQ INIT -------------------- */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* -------------------- STORAGE CONFIG -------------------- */
// Use persistent storage if provided (Render), otherwise default to local 'uploads'
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(__dirname, "uploads");
const MANIFEST_PATH = path.join(STORAGE_ROOT, "release_manifest.json");

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  console.log(`Created storage directory at: ${STORAGE_ROOT}`);
}

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_ROOT);
  },
  filename: (req, file, cb) => {
    // Save as 'app-[version].apk' or similar to avoid collisions
    const version = req.body.version || "unknown";
    cb(null, `app-${version}.apk`);
  }
});
const upload = multer({ storage });

/* -------------------- AI CONFIGURATION -------------------- */
const AI_CONFIG_PATH = path.join(STORAGE_ROOT, "ai_config.json");

// Default Configuration
const DEFAULT_AI_CONFIG = {
  system_role: "You are a professional human German tutor. Your goal is to help learners understand German naturally and clearly. You prioritize learner understanding and natural usage over academic grammar rules.",
  tone: "calm, friendly, and teacher-like", // "strict", "funny", "supportive"
  goethe_ref: true,
  ai_request_limit: 1000,
  model_dict: "llama-3.3-70b-versatile",
  model_general: "llama-3.1-8b-instant",
  rpm_limit: 1000,
  tpm_limit: 100000,
  word_counts: {
    "A1": 5, "A2": 8, "B1": 12, "B2": 15, "C1": 15, "C2": 20
  },
  tuning_instructions: "" // Custom fine-tuning for content generation
};

// Load Config with Fallback
let aiConfig = { ...DEFAULT_AI_CONFIG };
if (fs.existsSync(AI_CONFIG_PATH)) {
  try {
    const savedConfig = JSON.parse(fs.readFileSync(AI_CONFIG_PATH, "utf8"));
    aiConfig = { ...DEFAULT_AI_CONFIG, ...savedConfig }; // Merge to ensure new keys exist
    console.log("Loaded AI Config from storage.");
  } catch (err) {
    console.error("Failed to load AI config, using defaults:", err);
  }
}

// Helper to save config
function saveAiConfig() {
  fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(aiConfig, null, 2));
}

/* -------------------- DICTIONARY CACHE -------------------- */
const DICT_CACHE_PATH = path.join(STORAGE_ROOT, "dict_cache_v2.json");
let dictCache = {};

if (fs.existsSync(DICT_CACHE_PATH)) {
  try {
    dictCache = JSON.parse(fs.readFileSync(DICT_CACHE_PATH, "utf8"));
    console.log(`Loaded ${Object.keys(dictCache).length} cached translations.`);
  } catch (err) {
    console.error("Failed to load dict cache:", err);
  }
}

function saveDictCache() {
  try {
    fs.writeFileSync(DICT_CACHE_PATH, JSON.stringify(dictCache, null, 2));
  } catch (err) {
    console.error("Failed to save dict cache:", err);
  }
}

/* -------------------- GRAMMAR DATA SERVICE -------------------- */
const GRAMMAR_DATA_PATH = path.join(__dirname, "grammar_data.json");
let grammarData = { verbs: {} };

if (fs.existsSync(GRAMMAR_DATA_PATH)) {
  try {
    grammarData = JSON.parse(fs.readFileSync(GRAMMAR_DATA_PATH, "utf8"));
    console.log(`Loaded ${Object.keys(grammarData.verbs).length} irregular verbs.`);
  } catch (err) {
    console.error("Failed to load grammar data:", err);
  }
}

/**
 * Deterministically resolves grammar for a German term.
 * Supports smart matching for compound verbs (e.g., aufstehen -> stehen).
 */
function resolveGrammar(term) {
  if (!term) return null;
  const cleanTerm = term.toLowerCase().trim();

  // 1. Exact Match
  if (grammarData.verbs[cleanTerm]) {
    return { lemma: cleanTerm, ...grammarData.verbs[cleanTerm] };
  }

  // 2. Smart Matching (Compound Verbs)
  // Check for common separable prefixes
  const prefixes = [
    "ab", "an", "auf", "aus", "bei", "durch", "ein", "ent", "er", "fern",
    "fest", "her", "hin", "los", "mit", "nach", "um", "unter", "vor", "weg",
    "weiter", "wider", "zer", "zu", "zurück", "zusammen"
  ];

  for (const prefix of prefixes) {
    if (cleanTerm.startsWith(prefix) && cleanTerm.length > prefix.length) {
      const stem = cleanTerm.substring(prefix.length);
      if (grammarData.verbs[stem]) {
        return {
          lemma: cleanTerm,
          base_verb: stem,
          ...grammarData.verbs[stem],
          is_compound: true
        };
      }
    }
  }

  return null;
}

/* -------------------- AI USAGE TRACKING -------------------- */
const STATS_PATH = path.join(STORAGE_ROOT, "usage_stats.json");
let usageStats = {
  total_requests: 0,
  endpoints: {},
  models: {},
  last_request: null
};

if (fs.existsSync(STATS_PATH)) {
  try {
    const savedStats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
    usageStats = { ...usageStats, ...savedStats };
  } catch (err) {
    console.error("Failed to load usage stats:", err);
  }
}

function logAiUsage(endpoint, model) {
  usageStats.total_requests++;
  usageStats.last_request = new Date().toISOString();

  usageStats.endpoints[endpoint] = (usageStats.endpoints[endpoint] || 0) + 1;
  usageStats.models[model] = (usageStats.models[model] || 0) + 1;

  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(usageStats, null, 2));
  } catch (err) {
    console.error("Failed to save usage stats:", err);
  }
}

/**
 * Gets a sample of German words from the dictionary cache.
 */
function getVocabSample(count = 5) {
  const keys = Object.keys(dictCache);
  if (keys.length === 0) return "";

  // Extract German terms (handle de-en-word or en-de-word)
  const deTerms = keys
    .filter(k => k.startsWith('de-') || k.includes('-de-'))
    .map(k => {
      const entry = dictCache[k];
      return entry.term || entry.data?.german_full || "";
    })
    .filter(t => t.length > 0);

  if (deTerms.length === 0) return "";

  // Shuffle and pick
  const shuffled = deTerms.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join(", ");
}

// Serve static files from storage root (to allow downloading APKs)
app.use("/uploads", express.static(STORAGE_ROOT));

app.get("/api/usage", (req, res) => {
  res.json({
    success: true,
    stats: usageStats,
    limit: aiConfig.ai_request_limit || 1000
  });
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
        .stats-display { display: flex; flex-direction: column; gap: 1rem; }
        .stat-item { text-align: center; padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border); }
        .stat-value { font-size: 2.5rem; font-weight: 600; font-family: 'Outfit'; color: var(--accent); line-height: 1; display: block; }
        .endpoint-row { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
        .endpoint-row:last-child { border-bottom: none; }
        .endpoint-name { color: var(--text-muted); }
        .endpoint-count { font-weight: 600; color: var(--accent); }
        .progress-container { width: 100%; background: rgba(255,255,255,0.05); border-radius: 10px; height: 10px; margin-top: 1rem; overflow: hidden; border: 1px solid var(--border); }
        .progress-bar { height: 100%; background: linear-gradient(to right, var(--accent), #fff); width: 0%; transition: width 0.5s ease-out; }
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

            <!-- Live AI Tracking -->
            <div class="card" id="usage-card">
                <h3>Live AI Usage</h3>
                <div class="stats-display">
                    <div class="stat-item">
                        <span class="stat-value"><span id="total-req">0</span> <span style="font-size: 1rem; color: var(--text-muted); font-weight: 400;">/ <span id="total-limit">0</span></span></span>
                        <label>AI Requests Sent</label>
                        <div class="progress-container">
                            <div id="usage-progress" class="progress-bar"></div>
                        </div>
                    </div>
                    <div id="endpoint-stats" style="margin-top: 0.5rem;"></div>
                </div>
                <div id="usage-last-update" style="font-size: 0.7rem; color: var(--text-muted); margin-top: 1rem; text-align: right;">Last updated: Never</div>
            </div>

            <!-- AI Config Settings -->
            <div class="card" style="grid-column: span 1.5">
                <h3>AI Config Settings</h3>
                <div class="input-group">
                    <label>System Role (Personality)</label>
                    <input type="text" id="cfg-role" placeholder="e.g., Strict Grammar Expert">
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="input-group">
                        <label>Tone</label>
                        <select id="cfg-tone">
                            <option value="strict">Strict</option>
                            <option value="supportive">Supportive</option>
                            <option value="funny">Funny</option>
                            <option value="professional">Professional</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>Include B2 Reference?</label>
                        <div class="toggle-wrapper" style="padding: 0.5rem 1rem; margin: 0;">
                            <label class="switch">
                                <input type="checkbox" id="cfg-goethe">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                    <div class="input-group">
                        <label>Dictionary AI Model</label>
                        <select id="cfg-model-dict">
                            <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Versatile/Accuracy)</option>
                            <option value="llama-3.1-8b-instant">Llama 3.1 8B (Instant/Speed)</option>
                            <option value="llama3-70b-8192">Llama 3 70B</option>
                            <option value="llama3-8b-8192">Llama 3 8B</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>General AI Model</label>
                        <select id="cfg-model-gen">
                            <option value="llama-3.1-8b-instant">Llama 3.1 8B (Instant/Speed)</option>
                            <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Versatile/Accuracy)</option>
                            <option value="llama3-70b-8192">Llama 3 70B</option>
                            <option value="llama3-8b-8192">Llama 3 8B</option>
                        </select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                    <div class="input-group">
                        <label>RPM Limit (Requests/Min)</label>
                        <input type="number" id="cfg-rpm" placeholder="e.g., 1000">
                    </div>
                    <div class="input-group">
                        <label>TPM Limit (Tokens/Min)</label>
                        <input type="number" id="cfg-tpm" placeholder="e.g., 100000">
                    </div>
                </div>

                <label>Max Word Counts (per level)</label>
                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                    <input type="number" id="wc-a1" placeholder="A1" style="width: 60px;">
                    <input type="number" id="wc-a2" placeholder="A2" style="width: 60px;">
                    <input type="number" id="wc-b1" placeholder="B1" style="width: 60px;">
                    <input type="number" id="wc-b2" placeholder="B2" style="width: 60px;">
                    <input type="number" id="wc-c1" placeholder="C1" style="width: 60px;">
                </div>

                <div class="input-group">
                    <label>Content Fine-Tuning Instructions (Expert Mode)</label>
                    <textarea id="cfg-tuning" placeholder="e.g., Focus on B1 relative clauses. Avoid repeating simple verbs like 'gehen'." rows="3"></textarea>
                </div>

                <div class="input-group" style="display: none;">
                    <label style="color: var(--accent);">Admin API Key (Disabled)</label>
                    <input type="password" id="cfg-key" disabled value="no-key-needed">
                </div>

                <button onclick="saveConfig()">Save AI Settings</button>
                <div id="config-res" class="result-container"></div>
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

        async function loadConfig() {
            try {
                const res = await fetch('/admin/ai_config');
                const cfg = await res.json();
                
                document.getElementById('cfg-role').value = cfg.system_role || '';
                document.getElementById('cfg-tone').value = cfg.tone || 'supportive';
                document.getElementById('cfg-goethe').checked = cfg.goethe_ref || false;
                
                // New Fields
                document.getElementById('cfg-model-dict').value = cfg.model_dict || 'llama-3.3-70b-versatile';
                document.getElementById('cfg-model-gen').value = cfg.model_general || 'llama-3.1-8b-instant';
                document.getElementById('cfg-rpm').value = cfg.rpm_limit || 1000;
                document.getElementById('cfg-tpm').value = cfg.tpm_limit || 100000;

                if (cfg.word_counts) {
                    document.getElementById('wc-a1').value = cfg.word_counts.A1 || 5;
                    document.getElementById('wc-a2').value = cfg.word_counts.A2 || 8;
                    document.getElementById('wc-b1').value = cfg.word_counts.B1 || 12;
                    document.getElementById('wc-b2').value = cfg.word_counts.B2 || 15;
                    document.getElementById('wc-c1').value = cfg.word_counts.C1 || 15;
                }
                document.getElementById('cfg-tuning').value = cfg.tuning_instructions || '';
            } catch (err) {
                console.error("Failed to load config", err);
            }
        }

        async function saveConfig() {
            const resDiv = document.getElementById('config-res');
            const btn = document.querySelector('button[onclick="saveConfig()"]');
            
            // 1. Show immediate feedback
            btn.innerHTML = "Saving...";
            btn.disabled = true;
            resDiv.style.display = 'block'; // Ensure visibility
            resDiv.innerHTML = '<span style="color: var(--accent)">Connecting to server...</span>';
            resDiv.classList.add('active');
            
            const body = {
                system_role: document.getElementById('cfg-role').value,
                tone: document.getElementById('cfg-tone').value,
                goethe_ref: document.getElementById('cfg-goethe').checked,
                model_dict: document.getElementById('cfg-model-dict').value,
                model_general: document.getElementById('cfg-model-gen').value,
                rpm_limit: parseInt(document.getElementById('cfg-rpm').value) || 1000,
                tpm_limit: parseInt(document.getElementById('cfg-tpm').value) || 100000,
                word_counts: {
                    A1: parseInt(document.getElementById('wc-a1').value) || 5,
                    A2: parseInt(document.getElementById('wc-a2').value) || 8,
                    B1: parseInt(document.getElementById('wc-b1').value) || 12,
                    B2: parseInt(document.getElementById('wc-b2').value) || 15,
                    C1: parseInt(document.getElementById('wc-c1').value) || 15
                },
                tuning_instructions: document.getElementById('cfg-tuning').value
            };

            try {
                const res = await fetch('/admin/ai_config', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                
                if (data.success) {
                    const time = new Date().toLocaleTimeString();
                    resDiv.innerHTML = \`<span style="color: #00ff88; font-weight: bold;">✅ Saved Successfully at \${time}!</span><br><span style="font-size:0.8em; color: #ccc">Configuration updated on persistent storage.</span>\`;
                } else {
                    resDiv.innerHTML = \`<span style="color: #ff4757">❌ Error: \${data.error}</span>\`;
                }
            } catch (err) {
                resDiv.innerHTML = \`<span style="color: #ff4757">❌ Network Error: \${err.message}</span>\`;
            } finally {
                btn.innerHTML = "Save AI Settings";
                btn.disabled = false;
            }
        }

        // Load config on startup
        async function updateUsageStats() {
            try {
                const res = await fetch('/api/usage');
                const data = await res.json();
                if (data.success && data.stats) {
                    const stats = data.stats;
                    const limit = data.limit || 1000;
                    
                    document.getElementById('total-req').innerText = stats.total_requests || 0;
                    document.getElementById('total-limit').innerText = limit;
                    
                    const percent = Math.min(100, ((stats.total_requests || 0) / limit) * 100);
                    document.getElementById('usage-progress').style.width = percent + '%';
                    
                    const endpointDiv = document.getElementById('endpoint-stats');
                    endpointDiv.innerHTML = '';
                    
                    for (const [name, count] of Object.entries(stats.endpoints || {})) {
                        endpointDiv.innerHTML += \`
                            <div class="endpoint-row">
                                <span class="endpoint-name">\${name}</span>
                                <span class="endpoint-count">\${count}</span>
                            </div>
                        \`;
                    }
                    
                    if (stats.last_request) {
                        const date = new Date(stats.last_request);
                        document.getElementById('usage-last-update').innerText = 'Last: ' + date.toLocaleTimeString();
                    }
                }
            } catch (e) { console.error("Stats poll failed", e); }
        }

        window.onload = () => {
            loadConfig();
            updateUsageStats();
            setInterval(updateUsageStats, 2000);
        };
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
  const { term, from = "de", to = "en", bypass_cache = "false", context = "" } = req.method === 'POST' ? req.body : req.query;
  const queryTerm = term || req.body?.word;
  const shouldBypassCache = bypass_cache === "true" || bypass_cache === true;

  if (!queryTerm) {
    return res.status(400).json({ success: false, error: "Missing term" });
  }

  // Create a context-aware cache key
  const normalizedTerm = queryTerm.toLowerCase().trim();
  const contextHash = context ? `-${Buffer.from(context.toLowerCase().trim()).toString('hex').slice(0, 8)}` : "";
  const cacheKey = `${from}-${to}-${normalizedTerm}${contextHash}`;

  // Skip cache if bypass_cache is enabled (for AI learn mode)
  if (!shouldBypassCache) {
    // 1. Check Primary Cache (Directional + Contextual)
    if (dictCache[cacheKey]) {
      console.log(`Cache Hit (Primary): ${cacheKey}`);
      return serveCachedEntry(cacheKey, res);
    }

    // 2. Fallback to Generic cache (if context-less entry exists)
    const genericKey = `${from}-${to}-${normalizedTerm}`;
    if (!context && dictCache[genericKey]) {
      console.log(`Cache Hit (Generic): ${genericKey}`);
      return serveCachedEntry(genericKey, res);
    }

    // 3. Global Cache Search (Direction-Agnostic, ONLY Generic or Exact match)
    const globalMatch = Object.keys(dictCache).find(k => {
      // Must end with the term, and either be context-less OR match the current context hash
      const endsWithTerm = k.endsWith(`-${normalizedTerm}`);
      const isGeneric = k === `${from === 'de' ? 'en' : 'de'}-${from === 'de' ? 'de' : 'en'}-${normalizedTerm}`;
      const isSameContext = k.endsWith(`${normalizedTerm}${contextHash}`);
      return endsWithTerm && (isGeneric || isSameContext);
    });
    if (globalMatch) {
      console.log(`Cache Hit (Global): ${globalMatch} for ${queryTerm}`);
      return serveCachedEntry(globalMatch, res);
    }
  } else {
    console.log(`Cache Bypass: ${queryTerm} (AI Learn Mode)`);
  }

  function serveCachedEntry(key, response) {
    dictCache[key].hit_count = (dictCache[key].hit_count || 0) + 1;
    dictCache[key].last_queried = new Date().toISOString();
    saveDictCache();
    return response.json({
      success: true,
      ...dictCache[key],
      cached: true,
      already_in_vocab: true
    });
  }

  // Pre-lookup: Check Deterministic Grammar
  const grammarInfo = resolveGrammar(queryTerm);

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a German Grammar Expert and professional dictionary API. Respond ONLY in valid JSON." },
        {
          role: "user", content: `Lookup "${queryTerm}" (Source: ${from}, Target: ${to}).
        ${context ? `CONTEXT: "${context}" (Please provide the meaning that fits this specific sentence).` : ""}

        Rules:
        1. Identify the 'best' translation.
        2. If Source or Target is 'auto', you must detect the languages yourself (specifically between English and German).
        3. If the German term is a noun, you MUST include the definite article (der/die/das) and capitalize it (e.g., 'der Hund').
        4. Even if source is German, ensure 'german_full' is the explicit Article + Noun form.
        5. Provide gender (m/f/n) for German nouns.
        6. Provide 2-3 common alternate translations.
        7. For German words, provide additional grammar data:
           - artikel: "der", "die", or "das" (if noun)
           - plural: Plural form (if noun)
           - perfekt: Partizip II form (if verb)
           - praeteritum: Simple past form (if verb)
           - praesens: Present tense form for 2nd and 3rd person (e.g., "du liest, er liest") (if verb)
           - case: Dativ/Akkusativ usage if applicable
           - synonyms: list of 2 synonyms
           - example: A natural German example sentence.
           - exampleEn: The English translation of the example sentence.
           - vowel_change: e.g., "e -> ie" for "sehen". Return "N/A" if regular.
           - part_of_speech: "noun", "verb", "adjective", "adverb", "conjunction", "preposition", "pronoun", "interjection".
           - extra_info: e.g., "Irregular verb". Return "Regular verb" or "Regular noun" if normal.

        Return JSON: {
          "translation": "Main translation",
          "data": {
            "artikel": "...", "plural": "...", "perfekt": "...", "praeteritum": "...", "praesens": "...", 
            "case": "...", "gender": "...", "vowel_change": "...", "part_of_speech": "...", 
            "extra_info": "...", "synonyms": [...], "example": "...", "exampleEn": "..."
          },
          "detected_from": "${from}",
          "detected_to": "${to}"
        }` }
      ],
      model: aiConfig.model_dict || "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    logAiUsage("/dict", aiConfig.model_dict || "llama-3.3-70b-versatile");

    const aiData = JSON.parse(completion.choices[0]?.message?.content || "{}");

    if (!aiData.translation) {
      console.error(`AI failed to translate: ${queryTerm}`);
      return res.status(500).json({ success: false, error: "AI could not find a translation for this term." });
    }

    // APPLY DETERMINISTIC OVERRIDES
    let finalData = {
      artikel: aiData.data?.artikel || "N/A",
      plural: aiData.data?.plural || "N/A",
      perfekt: aiData.data?.perfekt || "N/A",
      praeteritum: aiData.data?.praeteritum || "N/A",
      praesens: aiData.data?.praesens || "N/A",
      case: aiData.data?.case || "N/A",
      gender: aiData.data?.gender || "N/A",
      vowel_change: aiData.data?.vowel_change || "N/A",
      extra_info: aiData.data?.extra_info || "N/A",
      part_of_speech: aiData.data?.part_of_speech || "N/A",
      synonyms: aiData.data?.synonyms || [],
      example: aiData.data?.example || "",
      exampleEn: aiData.data?.exampleEn || ""
    };

    if (grammarInfo) {
      // It's a known verb - enforce deterministic facts
      finalData.artikel = "N/A";
      finalData.plural = "N/A";
      finalData.vowel_change = grammarInfo.vowel_change;
      finalData.perfekt = grammarInfo.perfekt;
      finalData.praeteritum = grammarInfo.praeteritum;
      finalData.praesens = `er/sie/es ${grammarInfo.third_person}`;
      finalData.gender = "N/A";
      finalData.part_of_speech = "verb";
      finalData.extra_info = `Irregular verb (3rd pers: ${grammarInfo.third_person})`;
      if (grammarInfo.is_compound) {
        finalData.extra_info += `; Compound of '${grammarInfo.base_verb}'`;
      }
    }

    // Professional Audio URL (Google TTS)
    const audioTerm = (from === 'de' ? queryTerm : aiData.translation).trim();
    const audioLang = from === 'de' ? 'de' : 'en';
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(audioTerm)}&tl=${audioLang}&client=tw-ob`;

    const result = {
      term: queryTerm,
      context: context || null,
      translation: aiData.translation,
      data: finalData,
      audio_url: audioUrl,
      is_vocab: true, // Auto-promote to vocabulary
      hit_count: 1,
      last_queried: new Date().toISOString()
    };

    // Save to Cache
    dictCache[cacheKey] = result;
    saveDictCache();

    res.json({
      success: true,
      ...result
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
        { role: "user", content: `Generate a natural German sentence using the word "${queryWord}" for a ${level} level learner.Include an English translation.Format: { "german": "...", "english": "..." } ` }
      ],
      model: aiConfig.model_general || "llama-3.1-8b-instant", // Optimized for speed (prevent timeouts)
      response_format: { type: "json_object" }
    });

    logAiUsage("/sentence", aiConfig.model_general || "llama-3.1-8b-instant");

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

    const tuning = aiConfig.tuning_instructions ? `\n\nExtra Focus/Fine-Tuning: ${aiConfig.tuning_instructions}` : "";
    const vocab = getVocabSample(10);
    const vocabInstruction = vocab ? `\n\nPRIORITY VOCABULARY: You MUST try to use as many of these words as possible in the generated content (if they fit the level): ${vocab}.` : "";

    if (type === "en-de") {
      // MODE 1: Written Translation (EN -> DE)
      // User gets an English sentence, translates it to German (validated later by /evaluate)
      userPrompt = `Generate a level-appropriate English sentence for a ${level} CEFR German learner to translate.${tuning}
 
 Level Guidelines:
   - A1: Simple present tense, basic vocabulary(family, food, colors).Max ${aiConfig.word_counts.A1 || 5} words.
   - A2: Present / past tense, everyday topics.Max ${aiConfig.word_counts.A2 || 8} words.
   - B1: Multiple tenses, common idioms, longer sentences.Max ${aiConfig.word_counts.B1 || 12} words.
   - B2: Complex grammar(subjunctive, passive), abstract topics.Max ${aiConfig.word_counts.B2 || 15} words.
   - C1: Advanced structures, nuanced vocabulary, literary style.Max ${aiConfig.word_counts.C1 || 15} words.
 
      Format: { "question": "English sentence (Sentence case)", "context": "Brief English grammar hint (e.g., 'Use Perfekt tense')" } ${vocabInstruction}`;
    } else {
      // MODE 2: MCQ (DE -> EN)
      // User gets a German sentence, chooses right English meaning from 4 options
      userPrompt = `Generate a level-appropriate German sentence for a ${level} CEFR learner with 4 English MCQ options.${tuning}
 
 Level Guidelines:
   - A1: Basic vocabulary, simple present. Example: "Der Hund ist groß."
   - A2: Common verbs, past tense. Example: "Ich habe gestern Fußball gespielt."
   - B1: Modal verbs, subordinate clauses. Example: "Obwohl es regnet, gehe ich spazieren."
   - B2: Subjunctive, passive voice. Example: "Das Buch wurde von einem berühmten Autor geschrieben."
   - C1: Idiomatic expressions, complex syntax.
 
            Format: {
    "question": "German sentence (Sentence case)",
      "options": ["Option A (English)", "Option B (English)", "Option C (English)", "Option D (English)"],
        "answer": "The correct option string (English)",
          "explanation": "Brief level-appropriate explanation in English (2-4 sentences). Follow the tutor persona: calm, friendly, and focused on meaning first."
  } ${vocabInstruction}`;
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: aiConfig.model_general || "llama-3.1-8b-instant",
      response_format: { type: "json_object" }
    });

    logAiUsage("/learn/practice", aiConfig.model_general || "llama-3.1-8b-instant");

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
        {
          role: "system",
          content: `${aiConfig.system_role}. Tone: ${aiConfig.tone}. 
          
          TEACHING RULES PER LEVEL:
          - A1: Very short (1-2 points), ZERO grammar terms (no "accusative", "cases", etc.). Use patterns instead (e.g., "esse -> isst because he").
          - A2: Short (2-3 points), gentle grammar intro, meaning-first.
          - B1: Clear (3-4 points), simple grammar terms allowed.
          - B2: Explain structure/usage, compare forms, focus on nuance/style.
          - C1: Deeper explanations, formal vs informal, stylistic control.
          
          Respond ONLY in valid JSON.`
        },
        {
          role: "user", content: `Evaluate this ${level} CEFR learner's translation.
          
Original (${from === 'de' ? 'German' : 'English'}): "${sentence}"
User's Translation (${to === 'en' ? 'English' : 'German'}): "${translation}"

MANDATORY RESPONSE STRUCTURE:
1. corrected_answer: The FULLY CORRECTED sentence first. Proper capitalization, no explanation here.
2. feedback: 2-5 lines in simple English. Explain what changed and why. Meaning first, grammar second. Use level-appropriate rules (e.g. A1 MUST NOT use grammar terms).
3. b2_reference_answer: Optional advanced version. ONLY if it adds real value (time, reason, contrast, emphasis) and is natural. For A1/A2, NEVER show if confusing.

Return JSON: {
  "user_answer": "${translation}",
  "corrected_answer": "...",
  "feedback": "...",
  "b2_reference_answer": "..." (or null if not adding value or for low levels)
}` }
      ],
      model: aiConfig.model_general || "llama-3.1-8b-instant",
      response_format: { type: "json_object" }
    });

    logAiUsage("/evaluate", aiConfig.model_general || "llama-3.1-8b-instant");

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


/* -------------------- APP VERSION CHECK -------------------- */
app.get("/app_version.json", (req, res) => {
  // Try to read dynamic manifest, otherwise fallback to default
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      return res.json(manifest);
    }
  } catch (err) {
    console.error("Error reading manifest:", err);
  }

  // Fallback default
  res.json({
    android: {
      version: "1.1.7+12",
      url: "https://play.google.com/store/apps/details?id=com.yugdhawan.deutschfordisch",
      force_update: false,
      changelog: "Bug fixes and improvements"
    },
    ios: {
      version: "1.1.7+12",
      url: "https://apps.apple.com/app/id...",
      force_update: false,
      changelog: "Bug fixes and improvements"
    }
  });
});

/* -------------------- ADMIN: UPLOAD RELEASE -------------------- */
app.post("/admin/upload_release", upload.single("file"), (req, res) => {
  // Authentication Removed per user request

  // 2. Validate Request
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded" });
  }

  const { version, platform = "android", changelog = "" } = req.body;
  if (!version) {
    return res.status(400).json({ success: false, error: "Version is required" });
  }

  // 3. Generate Public URL
  // Assuming the server is hosted at root, constructing URL protocol + host + /uploads/filename
  const protocol = req.protocol;
  const host = req.get("host");
  const publicUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  try {
    // 4. Update Manifest JSON
    let manifest = {
      android: { version: "0.0.0", url: "", force_update: false, changelog: "" },
      ios: { version: "0.0.0", url: "", force_update: false, changelog: "" }
    };

    if (fs.existsSync(MANIFEST_PATH)) {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    }

    // Update specific platform info
    if (platform.toLowerCase() === "android") {
      manifest.android = {
        version,
        url: publicUrl,
        force_update: false,
        changelog
      };
    } else {
      // iOS doesn't usually allow direct IPA downloads this way, but we update metadata
      manifest.ios = {
        version,
        url: "https://apps.apple.com/app/id123456789", // Placeholder for logic
        force_update: false,
        changelog
      };
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    res.json({
      success: true,
      url: publicUrl,
      message: `Version ${version} published successfully.`
    });

  } catch (err) {
    console.error("Release update failed:", err);
    res.status(500).json({ success: false, error: "Failed to update manifest" });
  }
});

/* -------------------- ADMIN: AI CONFIG -------------------- */
app.get("/admin/ai_config", (req, res) => {
  res.json(aiConfig);
});

app.post("/admin/ai_config", (req, res) => {
  // Authentication Removed per user request
  const newConfig = req.body;
  // Basic validation could go here
  aiConfig = { ...aiConfig, ...newConfig };
  saveAiConfig();

  res.json({ success: true, message: "AI Configuration updated", config: aiConfig });
});

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`Server live on port ${PORT} `);
});