import fetch from "node-fetch";

const BASE_URL = "http://localhost:3000";

async function verifyTranslation() {
    console.log("--- Verifying Translation Enhancements ---");

    try {
        console.log("\nTesting Noun: 'table' (English -> German)");
        const tableRes = await fetch(`${BASE_URL}/dict?term=table&from=en&to=de`).then(r => r.json());
        console.log("Response:", JSON.stringify(tableRes, null, 2));

        if (tableRes.success && (tableRes.primary.toLowerCase().includes("der tisch") || tableRes.primary.toLowerCase().includes("die tabelle"))) {
            console.log("✅ Noun check passed: Article and word found.");
        } else {
            console.error("❌ Noun check failed: Article or word missing/incorrect.");
        }

        console.log("\nTesting Adjective: 'fast' (English -> German)");
        const fastRes = await fetch(`${BASE_URL}/dict?term=fast&from=en&to=de`).then(r => r.json());
        console.log("Response:", JSON.stringify(fastRes, null, 2));

        if (fastRes.success && fastRes.primary.includes(",")) {
            console.log("✅ Adjective check passed: Multiple meanings found (detected by comma).");
        } else {
            console.error("❌ Adjective check failed: Multiple meanings missing.");
        }

        console.log("\nTesting Noun: 'house' (Quality Check)");
        const houseRes = await fetch(`${BASE_URL}/dict?term=house&from=en&to=de`).then(r => r.json());
        console.log("Response:", JSON.stringify(houseRes, null, 2));

        if (houseRes.success && houseRes.primary.toLowerCase().includes("haus")) {
            const hasTante = houseRes.alternates.some(a => a.toLowerCase().includes("tante"));
            if (!hasTante && houseRes.alternates.length > 0) {
                console.log("✅ Quality check 'house' passed: 'Tante' is gone, alternates present.");
            } else {
                console.error("❌ Quality check 'house' failed: 'Tante' found or alternates missing.");
            }
        } else {
            console.error("❌ Quality check 'house' failed: 'Haus' missing or incorrect.");
        }

    } catch (e) {
        console.error("Verification script failed:", e.message);
        console.log("Is the server running? Start it with 'node server.js'");
    }
}

verifyTranslation();
