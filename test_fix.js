import fetch from "node-fetch";

const BASE_URL = "http://localhost:3000";

async function verifyFix() {
    console.log("--- Verifying AI Fix ---");

    try {
        console.log("\nTesting /sentence (Checking for 'data' key)...");
        const sentenceRes = await fetch(`${BASE_URL}/sentence?word=Test&level=A1`).then(r => r.json());
        console.log("Response:", JSON.stringify(sentenceRes, null, 2));

        if (sentenceRes.success && sentenceRes.data && sentenceRes.data.german && sentenceRes.data.english) {
            console.log("✅ /sentence check passed: 'data' key found and populated.");
        } else {
            console.error("❌ /sentence check failed: 'data' key missing or invalid.");
        }

        console.log("\nTesting /evaluate (Checking for 'data' key)...");
        const evalRes = await fetch(`${BASE_URL}/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sentence: "Hallo",
                translation: "Hello",
                level: "A1"
            })
        }).then(r => r.json());
        console.log("Response:", JSON.stringify(evalRes, null, 2));

        if (evalRes.success && evalRes.data && evalRes.data.score !== undefined && evalRes.data.feedback) {
            console.log("✅ /evaluate check passed: 'data' key found and populated.");
        } else {
            console.error("❌ /evaluate check failed: 'data' key missing or invalid.");
        }

    } catch (e) {
        console.error("Verification script failed:", e.message);
        console.log("Is the server running? Start it with 'node server.js'");
    }
}

verifyFix();
