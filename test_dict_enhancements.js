
import fetch from "node-fetch";

async function testDict() {
    const baseUrl = "http://localhost:3000"; // Adjust if necessary

    console.log("--- Test 1: Bank (Financial Context) ---");
    const res1 = await fetch(`${baseUrl}/dict?term=Bank&context=Ich muss Geld von der Bank abheben.&from=de&to=en`);
    const data1 = await res1.json();
    console.log(JSON.stringify(data1, null, 2));

    console.log("\n--- Test 2: Bank (Seating Context) ---");
    const res2 = await fetch(`${baseUrl}/dict?term=Bank&context=Ich sitze auf einer Bank im Park.&from=de&to=en`);
    const data2 = await res2.json();
    console.log(JSON.stringify(data2, null, 2));

    console.log("\n--- Test 3: Metadata Check (Haus) ---");
    const res3 = await fetch(`${baseUrl}/dict?term=Haus&from=de&to=en`);
    const data3 = await res3.json();
    console.log(JSON.stringify(data3, null, 2));
}

testDict().catch(console.error);
