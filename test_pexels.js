import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const apiKey = process.env.PEXELS_API_KEY;
  const searchKeyword = "car";
  console.log("Using API Key:", apiKey);
  try {
    const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(searchKeyword)}&per_page=1`, {
      headers: { Authorization: apiKey }
    });
    console.log("Status:", response.status);
    const data = await response.json();
    console.log("Data:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
