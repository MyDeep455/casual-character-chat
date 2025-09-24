import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import "dotenv/config";

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

const PROXY_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.OPENROUTER_API_KEY;

const getRawBody = (req) => {
    return new Promise((resolve, reject) => {
        const bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(bodyChunks).toString()));
        req.on('error', err => reject(err));
    });
};

app.post("/chat", async (req, res) => {
    
    const controller = new AbortController();
    req.on('abort', () => {
        console.log('Client disconnected, aborting fetch to OpenRouter.');
        controller.abort();
    });

    let reqBody;
    try {
        const rawBody = await getRawBody(req);
        if (!rawBody) {
            return res.status(400).json({ error: "Request body is empty." });
        }
        reqBody = JSON.parse(rawBody); 
    
    } catch (e) {
        console.error("Failed to parse body JSON:", e.message);
        return res.status(400).json({ error: "Invalid JSON format." });
    }

    if (!API_KEY) {
        console.error("ERROR: OPENROUTER_API_KEY not found on the server!");
        return res.status(500).json({ error: "API key is not configured on the server." });
    }

    try {
        const { character, chatHistory, userMessage, temperature = 0.7, modelName, frequency_penalty = 0.0, presence_penalty = 0.0 } = reqBody;

        if (!character || typeof userMessage === 'undefined') {
            return res.status(400).json({ error: "Character data and a message are required." });
        }

        const messages = [
            { role: "system", content: character.description },
            ...chatHistory
                .filter((msg) => msg.main)
                .map((msg) => ({
                    role: msg.sender === "ai" ? "assistant" : "user",
                    content: msg.main,
                })),
            { role: "user", content: userMessage },
        ];

        const apiResponse = await fetch(PROXY_API_URL, {
            method: "POST",
            signal: controller.signal, 
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`,
                "HTTP-Referer": "https://charakter-chat-backend.onrender.com", 
                "X-Title": "AI Charakter-Chat App",
            },
            body: JSON.stringify({
                model: modelName || "deepseek/deepseek-r1-0528:free",
                messages: messages,
                temperature: parseFloat(temperature),
                frequency_penalty: parseFloat(frequency_penalty),
                presence_penalty: parseFloat(presence_penalty),
                stream: true,
            }),
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error("Proxy API Error:", apiResponse.status, errorText);
            return res.status(apiResponse.status).end(errorText);
        }

        res.setHeader("Content-Type", "text/event-stream");
        apiResponse.body.pipe(res);
        
    } catch (error) {
        console.error("Error processing the request:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

app.listen(3000, "0.0.0.0", () => {
    console.log(`Server is running on port 3000 and is ready for connections.`);
});