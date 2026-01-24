import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import http from "http";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/', // Explicitly match frontend expectation
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Helper route to verify server is alive and Socket.io is mounted
app.get('/socket-test', (req, res) => {
  res.send('Server is alive! Socket.io is mounted at /socket.io/');
});
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* -------------------- GROQ INIT -------------------- */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* -------------------- STORAGE CONFIG -------------------- */
// Explicitly target Render persistent disk /var/lib/data if it exists, otherwise use STORAGE_PATH or local uploads
const RENDER_DISK = "/var/lib/data";
const STORAGE_ROOT = fs.existsSync(RENDER_DISK) ? RENDER_DISK : (process.env.STORAGE_PATH || path.join(__dirname, "uploads"));
const MANIFEST_PATH = path.join(STORAGE_ROOT, "release_manifest.json");

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}
console.log(`[STORAGE] Root: ${STORAGE_ROOT}`);
console.log(`[STORAGE] Manifest: ${MANIFEST_PATH}`);

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

/* -------------------- IMAGE CACHE & SEARCH -------------------- */
const IMAGE_CACHE_PATH = path.join(STORAGE_ROOT, "image_cache_v10.json"); // v10 for Category-Mapping Pixabay
let imageCache = {};

if (fs.existsSync(IMAGE_CACHE_PATH)) {
  try {
    imageCache = JSON.parse(fs.readFileSync(IMAGE_CACHE_PATH, "utf8"));
    console.log(`Loaded ${Object.keys(imageCache).length} cached images (v10).`);
  } catch (err) {
    console.error("Failed to load image cache:", err);
  }
}

function saveImageCache() {
  try {
    fs.writeFileSync(IMAGE_CACHE_PATH, JSON.stringify(imageCache, null, 2));
  } catch (err) {
    console.error("Failed to save image cache:", err);
  }
}

const FALLBACK_IMAGE = "https://placehold.co/1000x1000/023047/white.png?text=No+Image+Found"; // Stable placeholder

/* -------------------- STRUCTURED VOCABULARY -------------------- */
const VOCAB_PATH = path.join(__dirname, "vocabulary.json");
let vocabulary = [];
let vocabMap = {};

function loadVocabulary() {
  if (fs.existsSync(VOCAB_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(VOCAB_PATH, "utf8"));
      vocabulary = data.vocabulary || [];
      vocabMap = {};
      vocabulary.forEach(v => {
        vocabMap[v.word.toLowerCase().trim()] = v;
      });
      console.log(`[VOCAB] Loaded ${vocabulary.length} structured words.`);
    } catch (err) {
      console.error("[VOCAB] Failed to load vocabulary:", err);
    }
  }
}
loadVocabulary();

/**
/**
 * Uses AI only as a strict fallback to resolve dictionary metadata for search.
 */
async function getWordMetadata(word) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a professional image search expert. Identify the primary category for this noun and provide a 2-3 word literal English context for a physical photo. Categories: people, animals, places, objects, food, vehicles."
        },
        { role: "user", content: `Noun: "${word}"` }
      ],
      model: "llama-3.1-8b-instant",
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return {
      word,
      category: data.category || "objects",
      literal_context: data.literal_context || data.search_query || word,
      ai_detected: true
    };
  } catch (err) {
    console.error(`[AI Fallback] Metadata detection failed for ${word}:`, err);
    return { word, category: "objects", literal_context: word, ai_detected: false };
  }
}

/**
 * Searches for an image on Pixabay using STRICT deterministic rules.
 * Returns { url: string, logs: string[] }
 */
async function getOrSearchImage(word, forceCache = false) {
  const cleanWord = word.toLowerCase().trim();
  let vInfo = vocabMap[cleanWord];
  let isAiTarget = false;
  let logs = [];

  const log = (msg) => {
    console.log(msg);
    logs.push(msg);
  };

  // 1. Check verified cache
  const cacheKey = cleanWord;
  if (imageCache[cacheKey]) {
    log(`[CACHE] Found pre-verified image for "${cleanWord}"`);
    return { url: imageCache[cacheKey], logs };
  }

  // 2. Gameplay Info: Log if a live search is occurring during a match
  if (forceCache && !imageCache[cacheKey]) {
    log(`[INFO] Live search triggered for "${cleanWord}" during gameplay.`);
  }

  // 3. Resolve Metadata (Local Vocab > AI Fallback)
  if (!vInfo) {
    log(`[METADATA] Word "${cleanWord}" not in curated vocab. Calling AI fallback...`);
    vInfo = await getWordMetadata(cleanWord);
    isAiTarget = true;
  } else {
    log(`[METADATA] Using curated vocab entry for "${cleanWord}".`);
  }

  // 4. Construct Query
  let searchKeyword = (vInfo.search_terms && vInfo.search_terms.trim()) ? vInfo.search_terms.split(',').map(s => s.trim()).join(' ') : `${cleanWord} ${vInfo.literal_context || ''}`.trim();

  // Normalize Query: Replace slashes and other symbols that break Pixabay search with spaces
  searchKeyword = searchKeyword.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();

  const pixabayCategory = (vInfo.category === 'people') ? 'people' :
    (vInfo.category === 'animals') ? 'animals' :
      (vInfo.category === 'places') ? 'places' :
        (vInfo.category === 'food') ? 'food' :
          (vInfo.category === 'vehicles') ? 'transportation' :
            (vInfo.category === 'objects') ? '' : '';

  log(`[QUERY] Keywords: "${searchKeyword}", Category: "${pixabayCategory}"`);

  // 5. Search Pixabay (Strict Photographic Mode)
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey || apiKey.includes("YOUR_PIXABAY_API_KEY")) {
    log(`[ERROR] Pixabay API Key missing or invalid.`);
    return { url: FALLBACK_IMAGE, logs };
  }

  try {
    let url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(searchKeyword)}&image_type=photo&safesearch=true&order=popular&per_page=20`;
    if (pixabayCategory) url += `&category=${pixabayCategory}`;

    log(`[API] sending request to Pixabay...`);
    const response = await fetch(url);
    const data = await response.json();

    log(`[API] Hits received: ${data.hits ? data.hits.length : 0}`);

    if (data.hits && data.hits.length > 0) {
      // 6. Aggressive Blacklist (Strictly NO graphics/drawings)
      const blacklist = ["brand", "logo", "illustration", "vector", "drawing", "clipart", "sketch", "graphic", "text", "watermark", "icon", "abstract", "3d", "rendering"];

      const candidates = data.hits.filter(hit => {
        const ratio = hit.imageWidth / hit.imageHeight;
        const isHorizontal = ratio >= 1.2 && ratio <= 1.9;
        const tags = (hit.tags || "").toLowerCase();
        const hasGraphics = blacklist.some(tag => tags.includes(tag));

        if (!isHorizontal) log(`[FILTER] Rejected ID ${hit.id} (Tags: ${tags}): Bad Ratio (${ratio.toFixed(2)})`);
        if (hasGraphics) log(`[FILTER] Rejected ID ${hit.id} (Tags: ${tags}): Graphics Detected`);

        // Relaxation: If it's borderline horizontal (1.1 to 2.1) and NOT graphics, we might allow it if no perfect matches found
        return (isHorizontal || (ratio >= 1.0 && ratio <= 2.2)) && !hasGraphics;
      });

      log(`[FILTER] Candidates remaining: ${candidates.length}`);

      if (candidates.length > 0) {
        const selectedImage = candidates[0].webformatURL || candidates[0].largeImageURL;
        imageCache[cacheKey] = selectedImage;
        saveImageCache();
        log(`[SUCCESS] Selected image for "${cacheKey}": ${selectedImage}`);
        return { url: selectedImage, logs };
      }
    } else {
      log(`[FAIL] No hits returned from Pixabay.`);
    }
    log(`[FAIL] All candidates filtered out.`);
  } catch (err) {
    log(`[ERROR] API Request failed: ${err.message}`);
  }

  return { url: FALLBACK_IMAGE, logs };
}

/**
 * Validates if a term is an approved noun in the vocab list.
 * Returns the entry if found, otherwise null.
 */
function getNounEntry(noun) {
  const cleanNoun = noun.toLowerCase().trim();

  // Check dictCache for any entry that matches this term and is a noun
  const keys = Object.keys(dictCache);
  const foundKey = keys.find(k => {
    const entry = dictCache[k];
    const isTermMatch = entry.term?.toLowerCase() === cleanNoun;
    const isNoun = entry.data?.part_of_speech === "noun" || (entry.data?.artikel && entry.data?.artikel !== "N/A");
    return isTermMatch && isNoun;
  });

  return foundKey ? dictCache[foundKey] : null;
}

/* -------------------- MULTIPLAYER GAME FLOW -------------------- */
io.on("connection", (socket) => {
  console.log(`[SOCKET] Peer connected: ${socket.id}`);

  // Join a specific match room
  socket.on("join_match", (matchId) => {
    socket.join(matchId);
    console.log(`[SOCKET] ${socket.id} joined match: ${matchId}`);
  });

  // Start/Trigger a round with a word (server-authoritative)
  socket.on("trigger_round", async (data) => {
    const { matchId, noun } = data; // 'noun' is the English term
    if (!matchId || !noun) return;

    console.log(`[SOCKET] Round trigger in ${matchId} for: ${noun}`);

    // Resolve Image (Hybrid Cache/AI Flow)
    const result = await getOrSearchImage(noun, true);
    const vocabEntry = vocabMap[noun.toLowerCase().trim()] || { category: "objects" };

    // 3. Broadcast to all players in the match
    io.to(matchId).emit("new_round_image", {
      noun: noun,
      imageUrl: result.url,
      category: vocabEntry.category,
      round: Math.floor(data.round || 1)
    });

    console.log(`[SOCKET] Broadcasted image for "${noun}" to match ${matchId}`);
  });
  socket.on("disconnect", () => {
    console.log(`[SOCKET] Peer disconnected: ${socket.id}`);
  });
});

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
  total_tokens: 0,
  endpoints: {}, // { name: { requests, tokens } }
  models: {},    // { name: { requests, tokens } }
  recent_logs: [], // [ { timestamp, endpoint, model, tokens } ]
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

function logAiUsage(endpoint, model, tokens = 0) {
  usageStats.total_requests++;
  usageStats.total_tokens += tokens;
  const now = new Date().toISOString();
  usageStats.last_request = now;

  // Initialize if needed (legacy migration)
  if (typeof usageStats.endpoints[endpoint] === 'number') {
    usageStats.endpoints[endpoint] = { requests: usageStats.endpoints[endpoint], tokens: 0 };
  }
  if (typeof usageStats.models[model] === 'number') {
    usageStats.models[model] = { requests: usageStats.models[model], tokens: 0 };
  }

  // Update Endpoints
  if (!usageStats.endpoints[endpoint]) usageStats.endpoints[endpoint] = { requests: 0, tokens: 0 };
  usageStats.endpoints[endpoint].requests++;
  usageStats.endpoints[endpoint].tokens += tokens;

  // Update Models
  if (!usageStats.models[model]) usageStats.models[model] = { requests: 0, tokens: 0 };
  usageStats.models[model].requests++;
  usageStats.models[model].tokens += tokens;

  // Add to recent logs (keep last 15)
  usageStats.recent_logs.unshift({
    timestamp: now,
    endpoint,
    model,
    tokens
  });
  if (usageStats.recent_logs.length > 15) usageStats.recent_logs.pop();

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
    limit: aiConfig.ai_request_limit || 1000,
    token_limit: aiConfig.tpm_limit || 100000
  });
});

app.get("/api/test_image", async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const { query, populate = "false" } = req.query;
  if (!query) return res.status(400).json({ success: false, error: "Missing query" });

  const forceCache = populate !== "true";

  try {
    const result = await getOrSearchImage(query, forceCache);
    // We do NOT use the proxy in the JSON response, because the game client (Flutter) might want the raw URL.
    // However, the Dashboard HTML (browser) needs the proxy.
    res.json({
      success: true,
      word: query,
      imageUrl: result.url,
      logs: result.logs,
      is_cached: !!imageCache[query.toLowerCase().trim()],
      vocab_info: vocabMap[query.toLowerCase().trim()] || "Not in Vocab"
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PROXY ENDPOINT (Bypasses CORS/Hotlinking)
app.get("/api/image_proxy", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("Missing url");

  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" } // Pretend to be a browser
    });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

    // Forward content type (e.g., image/jpeg)
    res.setHeader("Content-Type", response.headers.get("content-type"));
    // Pipe the image stream directly to the client
    response.body.pipe(res);
  } catch (err) {
    console.error(`[PROXY] Error fetching ${imageUrl}:`, err);
    res.status(500).send("Proxy Error");
  }
});

// Admin endpoint to populate cache for all vocab words
app.get("/api/populate_all_cache", async (req, res) => {
  console.log("[ADMIN] Starting batch cache population...");
  let count = 0;
  for (const entry of vocabulary) {
    if (!imageCache[entry.word.toLowerCase()]) {
      await getOrSearchImage(entry.word, false);
      count++;
    }
  }
  res.json({ success: true, message: `Populated ${count} new images.` });
});

// Admin endpoint to clear a specific word from image cache
app.get("/api/clear_image_cache", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const { word } = req.query;
  if (!word) return res.status(400).json({ success: false, error: "Missing word" });

  const cleanWord = word.toLowerCase().trim();
  if (imageCache[cleanWord]) {
    delete imageCache[cleanWord];
    saveImageCache();
    console.log(`[ADMIN] Cleared image cache for: ${cleanWord}`);
    res.json({ success: true, message: `Cleared cache for ${cleanWord}` });
  } else {
    res.json({ success: true, message: `Word ${cleanWord} was not in cache` });
  }
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

            <!-- Image Search Tester -->
            <div class="card">
                <h3>Image Search Tester</h3>
                <div class="input-group">
                    <label>Keyword</label>
                    <input type="text" id="img-query" placeholder="e.g., Katze" onkeydown="if(event.key==='Enter') runTest('image')">
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="runTest('image')" style="flex: 2;">Test Search</button>
                    <button id="btn-refresh-img" onclick="refreshImage()" style="flex: 1; background: linear-gradient(135deg, #ff4757 0%, #ff6b81 100%); display: none;">Clear & Refresh</button>
                </div>
                <div id="image-res" class="result-container" style="text-align: center;"></div>
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
            <div class="card" id="usage-card" style="grid-column: span 1.5">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background: rgba(255,255,255,0.05); padding: 0.5rem 1rem; border-radius: 10px; margin-left: -1rem; margin-right: -1rem; margin-top: -1rem;">
                    <h3 style="margin:0; background:none; padding:0;">Live AI Usage</h3>
                    <div id="live-indicator" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.7rem; color: var(--accent); font-weight: bold; opacity: 0; transition: opacity 0.5s;">
                        <span style="width: 8px; height: 8px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 10px var(--accent);"></span>
                        LIVE REQUEST
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 2rem;">
                    <div class="stats-display">
                        <div class="stat-item">
                            <span class="stat-value"><span id="total-req">0</span> <span style="font-size: 1rem; color: var(--text-muted); font-weight: 400;">/ <span id="total-limit">0</span></span></span>
                            <label>AI Requests Sent</label>
                            <div class="progress-container">
                                <div id="usage-progress" class="progress-bar"></div>
                            </div>
                        </div>
                        <div class="stat-item" style="margin-top: 1rem;">
                            <span class="stat-value"><span id="total-tokens">0</span> <span style="font-size: 1rem; color: var(--text-muted); font-weight: 400;">/ <span id="token-limit-display">0</span></span></span>
                            <label>AI Tokens Used</label>
                            <div class="progress-container">
                                <div id="token-progress" class="progress-bar" style="background: linear-gradient(to right, #ff4757, var(--accent));"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 1rem; border: 1px solid var(--border);">
                        <label style="margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; display: block;">Endpoint Performance</label>
                        <div id="endpoint-stats" style="max-height: 180px; overflow-y: auto;"></div>
                    </div>
                </div>
                <div id="usage-last-update" style="font-size: 0.7rem; color: var(--text-muted); margin-top: 1rem; text-align: right;">Last updated: Never</div>
            </div>

            <!-- Recent Activity Log -->
            <div class="card" style="grid-column: span 1.5">
                <h3>Recent Activity Log</h3>
                <div id="recent-logs-container" style="background: #000; border-radius: 12px; border: 1px solid var(--border); overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem; text-align: left;">
                        <thead style="background: rgba(255,255,255,0.05); color: var(--text-muted);">
                            <tr>
                                <th style="padding: 0.75rem 1rem;">Time</th>
                                <th style="padding: 0.75rem 1rem;">Endpoint</th>
                                <th style="padding: 0.75rem 1rem;">Model</th>
                                <th style="padding: 0.75rem 1rem; text-align: right;">Tokens</th>
                            </tr>
                        </thead>
                        <tbody id="recent-logs-body">
                            <tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--text-muted);">Initializing activity log...</td></tr>
                        </tbody>
                    </table>
                </div>
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

        async function runTest(type, forceFresh = false) {
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
            } else if (type === 'image') {
                const q = document.getElementById('img-query').value;
                const pop = forceFresh ? 'true' : 'false';
                url = '/api/test_image?query=' + encodeURIComponent(q) + '&populate=' + pop + '&t=' + Date.now();
            }

            try {
                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: body ? JSON.stringify(body) : null
                });
                const data = await response.json();
                if (type === 'image' && data.success) {
                    document.getElementById('btn-refresh-img').style.display = 'block';
                    const info = data.vocab_info || {};
                    const isCached = data.is_cached;
                    const statusColor = isCached ? '#00ff88' : '#3a7bd5';
                    const statusLabel = isCached ? 'Verified (Cached)' : 'New Search';
                    
                    resDiv.innerHTML = \`
                        <div style="background: rgba(0,0,0,0.4); padding: 0.8rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.75rem; text-align: left; border: 1px solid var(--border);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                                <span style="color: var(--text-muted);">Source Mode:</span>
                                <span style="color: #00ff88; font-weight: bold;">STRICT DETERMINISTIC</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                                <span style="color: var(--text-muted);">Category:</span>
                                <span style="font-family: monospace; color: var(--accent);">\${info.category || 'objects'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                                <span style="color: var(--text-muted);">Resolved Query:</span>
                                <span style="font-family: monospace; color: #fff;">"\${data.word} \${info.literal_context || ''}"</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: var(--text-muted);">Cache Status:</span>
                                <span style="color: \${statusColor}; font-weight: bold;">\${statusLabel}</span>
                            </div>
                            <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1);">
                                <span style="color: var(--text-muted); display: block; margin-bottom: 0.2rem;">Server Logs:</span>
                                <pre style="font-size: 0.6rem; color: #aaa; white-space: pre-wrap;">\${(data.logs || []).join('\\n')}</pre>
                            </div>
                        </div>
                        <div style="text-align: center; margin-top: 1rem;">
                            <img src="/api/image_proxy?url=\${encodeURIComponent(data.imageUrl)}" onerror="this.style.display='none'; this.nextElementSibling.innerText='Image Load Failed';" style="max-width: 100%; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 5px 15px rgba(0,0,0,0.5); display: block; margin: 0 auto;">
                            <div style="font-size: 0.6rem; color: var(--text-muted); margin-top: 0.5rem; word-break: break-all; background: #000; padding: 0.4rem; border-radius: 4px;">\${data.imageUrl}</div>
                        </div>
                    \`;
                } else {
                    resDiv.innerHTML = \`<pre>\${JSON.stringify(data, null, 2)}</pre>\`;
                }
            } catch (err) {
                resDiv.innerHTML = \`<span style="color: #ff4757">Error: \${err.message}</span>\`;
            }
        }

        async function refreshImage() {
            const q = document.getElementById('img-query').value;
            if (!q) return;
            
            const btn = document.getElementById('btn-refresh-img');
            const originalText = btn.innerText;
            btn.innerText = "Clearing...";
            btn.disabled = true;

            try {
                // 1. Clear it
                await fetch(\`/api/clear_image_cache?word=\${encodeURIComponent(q)}\`);
                // 2. Run new search with forceFresh=true
                const resDiv = document.getElementById('image-res');
                resDiv.innerHTML = '<span style="color: var(--accent)">Refreshing...</span>';
                await runTest('image', true); 
            } catch (err) {
                console.error("Refresh failed:", err);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
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
        let lastRequestTimestamp = null;

        async function updateUsageStats() {
            try {
                const res = await fetch('/api/usage');
        const data = await res.json();
        if (data.success && data.stats) {
                    const stats = data.stats;
        const limit = data.limit || 1000;
        const tokenLimit = data.token_limit || 100000;

        document.getElementById('total-req').innerText = stats.total_requests || 0;
        document.getElementById('total-limit').innerText = limit;
        document.getElementById('total-tokens').innerText = (stats.total_tokens || 0).toLocaleString();
        document.getElementById('token-limit-display').innerText = tokenLimit.toLocaleString();

        const percent = Math.min(100, ((stats.total_requests || 0) / limit) * 100);
        document.getElementById('usage-progress').style.width = percent + '%';

        const tokenPercent = Math.min(100, ((stats.total_tokens || 0) / tokenLimit) * 100);
        document.getElementById('token-progress').style.width = tokenPercent + '%';

        // Endpoint Stats Table
        const endpointDiv = document.getElementById('endpoint-stats');
        endpointDiv.innerHTML = '';

        for (const [name, data] of Object.entries(stats.endpoints || { })) {
                        const count = typeof data === 'object' ? data.requests : data;
        const tokens = typeof data === 'object' ? data.tokens : 0;
        endpointDiv.innerHTML += \`
        <div class="endpoint-row" style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <span class="endpoint-name" style="font-weight: 500; font-family: monospace; color: var(--text);">\${name}</span>
          <div style="text-align: right;">
            <div style="font-weight: bold; color: var(--accent);">\${count} reqs</div>
            <div style="font-size: 0.65rem; color: var(--text-muted);">\${tokens.toLocaleString()} tokens</div>
          </div>
        </div>
        \`;
                    }

        // Recent Logs Table
        const logsBody = document.getElementById('recent-logs-body');
                    if (stats.recent_logs && stats.recent_logs.length > 0) {
          logsBody.innerHTML = stats.recent_logs.map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            return \`
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 0.75rem 1rem; color: var(--text-muted);">\${time}</td>
          <td style="padding: 0.75rem 1rem; font-family: monospace; color: #fff;">\${log.endpoint}</td>
          <td style="padding: 0.75rem 1rem; color: var(--text-muted);">\${log.model}</td>
          <td style="padding: 0.75rem 1rem; text-align: right; font-weight: bold; color: var(--accent);">\${log.tokens.toLocaleString()}</td>
        </tr>
        \`;
                        }).join('');
                    } else {
          logsBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--text-muted);">No recent activity tracked yet.</td></tr>';
                    }

        // Live Indicator logic
        if (stats.last_request && stats.last_request !== lastRequestTimestamp) {
                        const indicator = document.getElementById('live-indicator');
        if (lastRequestTimestamp !== null) { // Don't flash on first load
          indicator.style.opacity = '1';
                            setTimeout(() => indicator.style.opacity = '0', 2000);
                        }
        lastRequestTimestamp = stats.last_request;
        const date = new Date(stats.last_request);
        document.getElementById('usage-last-update').innerText = 'Last Activity: ' + date.toLocaleTimeString();
                    }
                }
            } catch (e) {console.error("Stats poll failed", e); }
        }

        window.onload = () => {
          loadConfig();
        updateUsageStats();
        setInterval(updateUsageStats, 2000);
        };
      </script>
    </body>
</html >
    `);
});

app.get("/test-ai", (req, res) => {
  res.send(`
    < !DOCTYPE html >
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {background: #111; color: #fff; font-family: sans-serif; text-align: center; padding: 20px; }
          button {padding: 15px 30px; font-size: 18px; background: #00d2ff; border: none; border-radius: 8px; cursor: pointer; }
          #log {margin - top: 20px; font-family: monospace; color: #0f0; }
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
  const contextHash = context ? `- ${Buffer.from(context.toLowerCase().trim()).toString('hex').slice(0, 8)}` : "";
  const dictCacheKey = `${from} - ${to} - ${normalizedTerm}${contextHash}`;

  // Skip cache if bypass_cache is enabled (for AI learn mode)
  if (!shouldBypassCache) {
    // 1. Check Primary Cache (Directional + Contextual)
    if (dictCache[dictCacheKey]) {
      console.log(`Cache Hit(Primary): ${dictCacheKey}`);
      return serveCachedEntry(dictCacheKey, res);
    }

    // 2. Fallback to Generic cache (if context-less entry exists)
    const genericKey = `${from} - ${to} - ${normalizedTerm}`;
    if (!context && dictCache[genericKey]) {
      console.log(`Cache Hit(Generic): ${genericKey}`);
      return serveCachedEntry(genericKey, res);
    }

    // 3. Global Cache Search (Direction-Agnostic, ONLY Generic or Exact match)
    const globalMatch = Object.keys(dictCache).find(k => {
      // Must end with the term, and either be context-less OR match the current context hash
      const endsWithTerm = k.endsWith(`- ${normalizedTerm}`);
      const isGeneric = k === `${from === 'de' ? 'en' : 'de'}-${from === 'de' ? 'de' : 'en'}-${normalizedTerm}`;
      const isSameContext = k.endsWith(`${normalizedTerm}${contextHash}`);
      return endsWithTerm && (isGeneric || isSameContext);
    });
    if (globalMatch) {
      console.log(`Cache Hit(Global): ${globalMatch} for ${queryTerm}`);
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
          role: "user", content: `Lookup "${queryTerm}"(Source: ${from}, Target: ${to}).
  ${context ? `CONTEXT: "${context}" (Please provide the meaning that fits this specific sentence).` : ""}

Rules:
1. Identify the 'best' translation.
        2. Detect the language of the term(English or German).
        3. If the German term is a noun, you MUST include the definite article(der / die / das) and capitalize it(e.g., 'der Hund').
        4. Even if source is German, ensure 'german_full' is the explicit Article + Noun form.
        5. Provide gender(m / f / n) for German nouns.
        6. Provide exactly 2 common alternate translations in the 'alternates' array.
        7. For German words, provide additional grammar data:
- artikel: "der", "die", or "das"(if noun)
  - plural: Plural form(if noun)
  - perfekt: Partizip II form(if verb)
  - praeteritum: Simple past form(if verb)
  - praesens: Present tense form for 2nd and 3rd person(e.g., "du liest, er liest")(if verb)
  - case: Dativ / Akkusativ usage if applicable
    - synonyms: list of 2 synonyms
      - example: A natural German example sentence.
           - exampleEn: The English translation of the example sentence.
           - vowel_change: e.g., "e -> ie" for "sehen".Return "N/A" if regular.
           - part_of_speech: "noun", "verb", "adjective", "adverb", "conjunction", "preposition", "pronoun", "interjection".
           - extra_info: e.g., "Irregular verb".Return "Regular verb" or "Regular noun" if normal.

        Return JSON: {
  "translation": "Main translation",
    "alternates": ["alt1", "alt2"],
      "detected_from": "de or en",
        "detected_to": "en or de",
          "data": {
    "artikel": "...", "plural": "...", "perfekt": "...", "praeteritum": "...", "praesens": "...",
      "case": "...", "gender": "...", "vowel_change": "...", "part_of_speech": "...",
        "extra_info": "...", "synonyms": [...], "example": "...", "exampleEn": "..."
  }
} ` }
      ],
      model: aiConfig.model_dict || "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    logAiUsage("/dict", aiConfig.model_dict || "llama-3.3-70b-versatile", completion.usage?.total_tokens || 0);

    const aiData = JSON.parse(completion.choices[0]?.message?.content || "{}");

    if (!aiData.translation) {
      console.error(`AI failed to translate: ${queryTerm} `);
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
      finalData.praesens = `er / sie / es ${grammarInfo.third_person} `;
      finalData.gender = "N/A";
      finalData.part_of_speech = "verb";
      finalData.extra_info = `Irregular verb(3rd pers: ${grammarInfo.third_person})`;
      if (grammarInfo.is_compound) {
        finalData.extra_info += `; Compound of '${grammarInfo.base_verb}'`;
      }
    }

    // Professional Audio URL (Google TTS)
    const audioTerm = (aiData.detected_from === 'de' ? queryTerm : aiData.translation).trim();
    const audioLang = aiData.detected_from === 'de' ? 'de' : 'en';
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(audioTerm)}&tl=${audioLang}&client=tw-ob`;

    const result = {
      term: queryTerm,
      context: context || null,
      translation: aiData.translation,
      alternates: aiData.alternates || [],
      from: aiData.detected_from || from,
      to: aiData.detected_to || to,
      data: finalData,
      audio_url: audioUrl,
      is_vocab: true, // Auto-promote to vocabulary
      hit_count: 1,
      last_queried: new Date().toISOString()
    };

    // Save to Cache
    dictCache[dictCacheKey] = result;
    saveDictCache();

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error("Dict error:", err);
    res.status(500).json({ success: false, error: "Dictionary lookup failed: " + err.message });
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

    logAiUsage("/sentence", aiConfig.model_general || "llama-3.1-8b-instant", completion.usage?.total_tokens || 0);

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

    logAiUsage("/learn/practice", aiConfig.model_general || "llama-3.1-8b-instant", completion.usage?.total_tokens || 0);

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

/* -------------------- AI: STORY MODE -------------------- */
app.post("/learn/story", async (req, res) => {
  const { words = [], level = "A1" } = req.body;

  try {
    const wordList = words.length > 0 ? words.join(", ") : "common daily objects";
    const systemPrompt = "You are a professional language tutor. Respond ONLY in valid JSON format.";
    const userPrompt = `Generate a very short, level-appropriate German story (3-5 sentences) for a ${level} CEFR learner.
    
    WORDS TO INCLUDE: ${wordList}
    
    The story should be followed by 1 multiple-choice comprehension question in English.
    
    Format: {
      "story_german": "...",
      "story_english": "...",
      "question": "Comprehension question in English",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": "Correct option string",
      "explanation": "Brief explanation in English"
    }`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: aiConfig.model_general || "llama-3.1-8b-instant",
      response_format: { type: "json_object" }
    });

    logAiUsage("/learn/story", aiConfig.model_general || "llama-3.1-8b-instant", completion.usage?.total_tokens || 0);

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("AI Story error:", err.message);
    res.status(500).json({ success: false, error: "Story generation failed" });
  }
});

/* -------------------- EXAM: MOCK TEST -------------------- */
app.get("/exam/mock", async (req, res) => {
  const { level = "B1", mode = "full", module: examModule = "all" } = req.query;

  let duration = level === 'B1' ? 65 : 75;
  if (mode === 'quick') duration = 15;

  let moduleInstruction = "";
  if (examModule !== "all") {
    moduleInstruction = `
CRITICAL: The user has requested ONLY the ${examModule} module. 
- You MUST NOT generate any other sections (e.g., if "Lesen" is selected, do not generate Grammatik or Sprechen).
- Focus all 3000 tokens on making this single module highly detailed and rigorous.
`;
  }

  let modeInstruction = "";
  if (mode === "quick") {
    modeInstruction = `
CRITICAL: This is a "Quick Blitz" session (15 minutes).
- Keep the content extremely condensed.
- Generate only 1 or 2 high-impact tasks total.
- Ensure the difficulty remains ${level}, but the quantity is small enough to finish in 15 minutes.
`;
  }

  const prompt = `
Generate a highly authentic, rigorous Goethe-Zertifikat ${level} Mock Exam.
${modeInstruction}
${moduleInstruction}

The response MUST be a single, valid JSON object containing exactly these fields:
- "title": "Goethe-Zertifikat ${level} ${examModule === 'all' ? 'Modelltest' : examModule}"
- "duration_minutes": ${duration}
- "sections": An array of objects. Each section object has:
  - "title": String (e.g., "Lesen Teil 1")
  - "instructions": Detailed German instructions
  - "tasks": An array of objects. Each task has:
    - "context": A substantial text in German (appropriate for the level).
    - "questions": An array of objects. Each question has:
      - "text": The question in German.
      - "options": Array of 3 strings (MCQ).
      - "correct_index": Number (0-2).

Authenticity Guidelines for ${level}:
1. Topic Areas: Beruf, Ausbildung, Umwelt, Reisen, Gesellschaft, Kommunikation.
2. Linguistic Rigor: Use ${level} level grammar (Passiv, Konjunktiv, etc.).
3. Section Map (ONLY include items relevant to "${examModule}"):
   - Part 1-3: Lesen (Reading)
   - Part 4: Grammatik / Sprachbausteine
   - Part 5: Sprechen (Interactive oral task. Context only, no questions).

Strictly follow the ${level} word lists. Deliver ONLY raw JSON. No markdown.
`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: aiConfig.system_role },
        { role: "user", content: prompt }
      ],
      model: aiConfig.model_dict, // Use 70B for high-quality exam generation
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: "json_object" }
    });

    const resultString = completion.choices[0].message.content;
    const resultJson = JSON.parse(resultString);

    logAiUsage("/exam/mock", aiConfig.model_dict || "llama-3.3-70b-versatile", completion.usage?.total_tokens || 0);

    res.json({
      success: true,
      data: resultJson
    });

  } catch (err) {
    console.error("Mock Test generation failed:", err);
    res.status(500).json({ success: false, error: "Failed to generate mock exam. Please try again." });
  }
});

/* -------------------- EXAM: SPEAKING PARTNER -------------------- */
app.post("/exam/speak", async (req, res) => {
  const { level, chatHistory, taskDescription } = req.body;
  const model = "llama-3.1-8b-instant"; // Fast and high rate limits

  const systemRole = `
You are a German exam partner for the Goethe-Zertifikat ${level} Speaking module.
Your goal is to have an authentic, helpful, but rigorous dialogue with the candidate.

Current Task: ${taskDescription}

Rules:
1. Speak ONLY in German.
2. Be natural but follow the level-specific grammar and vocabulary.
3. Keep your responses relatively short (max 2-3 sentences) to maintain a fast dialogue.
4. If it's a planning task (B1), propose ideas and ask for the candidate's opinion.
5. If it's a discussion (B2), express your own viewpoint and ask the candidate to elaborate.
6. Do NOT correct their grammar during the conversation unless it's completely unintelligible. Stay in character.
`;

  try {
    const messages = [
      { role: "system", content: systemRole },
      ...chatHistory
    ];

    const completion = await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0].message.content;
    logAiUsage("/exam/speak", model, completion.usage?.total_tokens || 0);
    res.json({ success: true, response });
  } catch (err) {
    console.error("Speaking API Error:", err);
    res.status(500).json({ success: false, error: "AI Partner is busy. Try again." });
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

    logAiUsage("/evaluate", aiConfig.model_general || "llama-3.1-8b-instant", completion.usage?.total_tokens || 0);

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
const FALLBACK_MANIFEST = {
  android: {
    version: "1.1.7+12",
    url: "http://deutschfordisch-server.onrender.com/uploads/app-unknown.apk",
    force_update: false,
    changelog: "Bug fixes and improvements"
  },
  ios: {
    version: "1.1.7+12",
    url: "https://apps.apple.com/app/id6740695079",
    force_update: false,
    changelog: "Bug fixes and improvements"
  }
};

app.get("/app_version.json", (req, res) => {
  // Always start with fallback values
  let manifest = { ...FALLBACK_MANIFEST };

  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const savedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      // Merge: Stored version overrides code fallback ONLY if it looks valid
      if (savedManifest.android && savedManifest.android.version !== "0.0.0") {
        manifest.android = { ...manifest.android, ...savedManifest.android };
      }
      if (savedManifest.ios && savedManifest.ios.version !== "0.0.0") {
        manifest.ios = { ...manifest.ios, ...savedManifest.ios };
      }
    }
  } catch (err) {
    console.error("Error reading manifest, using hardcoded fallbacks:", err);
  }

  res.json(manifest);
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
        url: "https://apps.apple.com/app/id6740695079", // Official iOS link
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
server.listen(PORT, async () => {
  console.log(`Server live on port ${PORT} `);

  // Background Cache Population
  console.log("[CACHE] Starting background population of curated vocab...");
  setTimeout(async () => {
    let populatedCount = 0;
    for (const entry of vocabulary) {
      const word = entry.word.toLowerCase();
      if (!imageCache[word]) {
        try {
          await getOrSearchImage(word, false);
          populatedCount++;
          // Minimal delay to avoid Pixabay rate limits during startup
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error(`[CACHE] Failed to auto-populate ${word}:`, err.message);
        }
      }
    }
    console.log(`[CACHE] Background population complete. Added ${populatedCount} images.`);
  }, 5000); // Wait 5s after start to avoid competing with startup IO
});