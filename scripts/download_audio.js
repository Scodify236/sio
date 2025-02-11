const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const COBALT_API = "https://api.allorigins.win/raw?url=https://cobalt-api.kwiatekmiki.com";
const CHANNEL_API = "https://backendmix-emergeny.vercel.app/list";
const DOWNLOAD_DIR = path.join(__dirname, "..", "sio");
const DOWNLOADS_JSON = path.join(__dirname, "..", "downloads.json");
const MAX_RETRIES = 3;
const CHANNEL_ID = "UCEEi1lDCkKi1ukmTAgc9-zA"; 
const FILE_BASE_URL = "https://sioyt.netlify.app/sio/";

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Load existing downloads
let downloadsData = {};
if (fs.existsSync(DOWNLOADS_JSON)) {
    try {
        downloadsData = JSON.parse(fs.readFileSync(DOWNLOADS_JSON, "utf-8"));
    } catch (err) {
        console.error("❌ Failed to load downloads.json, resetting file.");
        downloadsData = {};
    }
}

(async () => {
    try {
        console.log(`🔍 Fetching videos for channel ID: ${CHANNEL_ID}...`);
        const response = await axios.get(`${CHANNEL_API}/${CHANNEL_ID}`);
        const videos = response.data?.videos || [];
        
        if (videos.length === 0) {
            console.error("❌ No videos found for this channel.");
            process.exit(1);
        }

        console.log(`📹 Found ${videos.length} videos. Checking for new downloads...`);
        
        for (const video of videos) {
            const videoId = video.id;
            const videoTitle = video.title;
            const filename = `${videoId}.mp3`;
            const filePath = path.join(DOWNLOAD_DIR, filename);
            const fileUrl = `${FILE_BASE_URL}${filename}`;

            if (downloadsData[videoId] && fs.existsSync(filePath) && downloadsData[videoId].size > 0) {
                console.log(`⏭️ Skipping ${videoTitle}, already downloaded and valid.`);
                continue;
            }

            console.log(`🎵 Downloading: ${videoTitle} (ID: ${videoId})...`);
            let success = false;
            
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`🔄 Attempt ${attempt}/${MAX_RETRIES}...`);
                    const { data: downloadResponse } = await axios.post(
                        `${COBALT_API}/`,
                        { url: `https://www.youtube.com/watch?v=${videoId}`, audioFormat: "mp3" },
                        { headers: { "Accept": "application/json", "Content-Type": "application/json" } }
                    );
                    
                    console.log("🔍 Cobalt API Response:", downloadResponse);
                    const { status, url } = downloadResponse;
                    if (!url || (status !== "redirect" && status !== "tunnel")) {
                        throw new Error("Invalid audio URL");
                    }

                    const { data: audioData } = await axios({ url, method: "GET", responseType: "arraybuffer" });
                    if (!audioData || audioData.length === 0) {
                        throw new Error("Downloaded data is empty");
                    }
                    
                    fs.writeFileSync(filePath, audioData);
                    const fileSize = fs.statSync(filePath).size;
                    if (fileSize === 0) {
                        throw new Error("Downloaded file size is 0 bytes");
                    }

                    console.log(`✅ Downloaded: ${filePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                    downloadsData[videoId] = { title: videoTitle, id: videoId, filePath: fileUrl, size: fileSize };
                    fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(downloadsData, null, 2));
                    commitFile(filePath, videoId);
                    success = true;
                    break;
                } catch (err) {
                    console.error(`⚠️ Error downloading ${videoTitle}: ${err.message}`);
                    if (attempt === MAX_RETRIES) {
                        console.error(`❌ Failed after ${MAX_RETRIES} attempts, skipping.`);
                    }
                }
            }

            if (!success) {
                console.error(`🚨 Skipped: ${videoTitle} due to repeated errors.`);
            }
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
})();

function commitFile(filePath, videoId) {
    try {
        execSync("git config --global user.name 'github-actions'");
        execSync("git config --global user.email 'github-actions@github.com'");
        execSync(`git add "${filePath}" "${DOWNLOADS_JSON}"`);
        execSync(`git commit -m "Add downloaded audio for ${videoId}"`);
        execSync("git push");
        console.log(`📤 Committed and pushed ${filePath}`);
    } catch (err) {
        console.error("❌ Error committing file:", err.message);
    }
}
