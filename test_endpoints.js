import fetch from "node-fetch";

const BASE_URL = "http://localhost:3000";

async function test() {
    console.log("--- Testing Health ---");
    try {
        const health = await fetch(`${BASE_URL}/health`).then(r => r.json());
        console.log("Health:", health);
    } catch (e) {
        console.error("Health failed:", e.message);
    }

    console.log("\n--- Testing Dictionary (dict.cc) ---");
    try {
        const dict = await fetch(`${BASE_URL}/dict?term=Haus`).then(r => r.json());
        console.log("Dict (Haus):", dict);
    } catch (e) {
        console.error("Dict failed:", e.message);
    }

    console.log("\n--- Testing Sentence Generation (AI) ---");
    try {
        const sentence = await fetch(`${BASE_URL}/sentence?word=Auto&level=A1`).then(r => r.json());
        console.log("Sentence (Auto, A1):", sentence);
    } catch (e) {
        console.error("Sentence failed:", e.message);
    }

    console.log("\n--- Testing Translation Evaluation (AI) ---");
    try {
        const evalData = await fetch(`${BASE_URL}/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sentence: "Ich habe ein Auto.",
                translation: "I have a car.",
                level: "A1"
            })
        }).then(r => r.json());
        console.log("Evaluation:", evalData);
    } catch (e) {
        console.error("Evaluation failed:", e.message);
    }
}

test();
