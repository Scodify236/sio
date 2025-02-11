const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const COBALT_API = "https://cobalt-api.kwiatekmiki.com";
const CHANNEL_API = "https://backendmix-emergeny.vercel.app/list";
const DOWNLOAD_DIR = path.join(__dirname, "..", "sio");
const DOWNLOADS_JSON = path.join(__dirname, "..", "downloads.json");
const MAX_RETRIES = 3;
const CHANNEL_ID = "UCEEi1lDCkKi1ukmTAgc9-zA"; 
const FILE_BASE_URL = "https://sioyt.netlify.app/sio/";

// Create axios instance with timeout and error handling
const axiosInstance = axios.create({
    timeout: 30000, // 30 second timeout
    validateStatus: status => status >= 200 && status < 300
});

// Initialize directory and downloads data
async function initialize() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    let downloadsData = {};
    if (fs.existsSync(DOWNLOADS_JSON)) {
        try {
            downloadsData = JSON.parse(fs.readFileSync(DOWNLOADS_JSON, "utf-8"));
            console.log("📚 Loaded existing downloads data");
        } catch (err) {
            console.error("❌ Failed to load downloads.json:", err.message);
            console.log("🔄 Creating new downloads data");
        }
    }
    return downloadsData;
}

// Fetch channel videos
async function fetchChannelVideos() {
    try {
        console.log(`🔍 Fetching videos for channel ID: ${CHANNEL_ID}...`);
        const response = await axiosInstance.get(`${CHANNEL_API}/${CHANNEL_ID}`);
        console.log("📡 Channel API Response:", JSON.stringify(response.data, null, 2));

        if (!response.data?.videos?.length) {
            throw new Error("No videos found in channel response");
        }

        return response.data.videos;
    } catch (err) {
        console.error("❌ Channel API Error:", err.response?.data || err.message);
        throw err;
    }
}

// Download single video
async function downloadVideo(video, downloadsData) {
    const { id: videoId, title: videoTitle } = video;
    const filename = `${videoId}.mp3`;
    const filePath = path.join(DOWNLOAD_DIR, filename);
    const fileUrl = `${FILE_BASE_URL}${filename}`;

    // Skip if already downloaded and valid
    if (downloadsData[videoId] && fs.existsSync(filePath) && downloadsData[videoId].size > 0) {
        console.log(`⏭️ Skipping ${videoTitle}, already downloaded and valid.`);
        return true;
    }

    console.log(`🎵 Downloading audio for: ${videoTitle} (ID: ${videoId})...`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`🔄 Attempt ${attempt}/${MAX_RETRIES}...`);

            // Get download URL from Cobalt API
            const downloadResponse = await axiosInstance.post(
                `${COBALT_API}/`,
                {
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    audioFormat: "mp3",
                    downloadMode: "audio"
                },
                {
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    }
                }
            );

            console.log("📡 Cobalt API Response:", JSON.stringify(downloadResponse.data, null, 2));

            const { status, url } = downloadResponse.data;
            if (status !== "redirect" && status !== "tunnel") {
                throw new Error(`Invalid status: ${status}`);
            }

            // Download and save the audio file
            const writer = fs.createWriteStream(filePath);
            const audioResponse = await axiosInstance({
                url,
                method: "GET",
                responseType: "stream"
            });

            audioResponse.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            const fileSize = fs.statSync(filePath).size;
            if (fileSize === 0) {
                throw new Error("Downloaded file is empty");
            }

            console.log(`✅ Downloaded: ${filePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

            // Update downloads data
            downloadsData[videoId] = {
                title: videoTitle,
                id: videoId,
                filePath: fileUrl,
                size: fileSize,
                downloadedAt: new Date().toISOString()
            };

            fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(downloadsData, null, 2));
            await commitFile(filePath, videoId);
            return true;

        } catch (err) {
            console.error(`⚠️ Error downloading ${videoTitle} (Attempt ${attempt}/${MAX_RETRIES}):`, 
                err.response?.data || err.message);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath); // Clean up failed download
            }
            
            if (attempt === MAX_RETRIES) {
                console.error(`❌ Failed after ${MAX_RETRIES} attempts`);
                return false;
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        }
    }
}

// Commit file to repository
async function commitFile(filePath, videoId) {
    try {
        execSync("git config --global user.name 'github-actions'");
        execSync("git config --global user.email 'github-actions@github.com'");
        execSync(`git add "${filePath}" "${DOWNLOADS_JSON}"`);
        execSync(`git commit -m "Add downloaded audio for ${videoId}"`);
        execSync("git push");
        console.log(`📤 Committed and pushed ${filePath}`);
    } catch (err) {
        console.error("❌ Git commit error:", err.message);
        throw err;
    }
}

// Main execution
(async () => {
    try {
        const downloadsData = await initialize();
        const videos = await fetchChannelVideos();
        console.log(`📹 Found ${videos.length} videos. Starting download process...`);

        for (const video of videos) {
            await downloadVideo(video, downloadsData);
        }

        console.log("✅ Processing complete!");
    } catch (error) {
        console.error("🚨 Fatal error:", error.message);
        process.exit(1);
    }
})();
