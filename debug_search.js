import fetch from "node-fetch";

async function testSearch() {
    const searchKeyword = "cat";

    // 1. Pixabay (Primary)
    const pixabayKey = "48043864-d62c26207b9a23992224090c2";
    console.log("Testing Pixabay...");
    try {
        const res = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${searchKeyword}&image_type=photo&per_page=3`);
        console.log(`Pixabay Status: ${res.status}`);
        if (res.ok) {
            const data = await res.json();
            console.log("Pixabay Result:", data.hits ? data.hits.length : "No hits");
        } else {
            console.log("Pixabay Output:", await res.text());
        }
    } catch (e) {
        console.error("Pixabay Error:", e.message);
    }

    // 2. Pexels (Secondary)
    const pexelsKey = "S8v27Hs4NMFgPJsm9ztEjhvEMDeMlcsplvzdAFcdGq5ycHzArCap4PJJ";
    console.log("\nTesting Pexels...");
    try {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${searchKeyword}&orientation=square&per_page=1`, {
            headers: {
                Authorization: pexelsKey,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        console.log(`Pexels Status: ${res.status}`);
        if (res.ok) {
            const data = await res.json();
            console.log("Pexels Result:", data.photos ? data.photos.length : "No photos");
            if (data.photos && data.photos.length > 0) {
                console.log("Pexels URL:", data.photos[0].src.large);
            }
        } else {
            console.log("Pexels Output:", await res.text());
        }
    } catch (e) {
        console.error("Pexels Error:", e.message);
    }
}

testSearch();
