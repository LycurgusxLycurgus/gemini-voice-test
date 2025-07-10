const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Modality } = require('@google/genai');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const MODEL_NAME = "gemini-2.5-flash-preview-native-audio-dialog";

if (API_KEY === "YOUR_API_KEY_HERE") {
    console.error("\n!!! ERROR: Please set your API_KEY in server.js !!!\n");
    process.exit(1);
}

// --- STATIC FILE SERVER ---
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.txt': 'text/plain',
        '.js': 'application/javascript',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('404: File Not Found', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// --- WEBSOCKET PROXY SERVER ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws) => {
    console.log('Client connected');

    try {
        const systemInstructionText = fs.readFileSync('system_prompt.txt', 'utf8');
        const ai = new GoogleGenAI({ apiKey: API_KEY });

        const config = {
            responseModalities: [Modality.AUDIO],
            // --- FIX: Add speechConfig to specify voice and language ---
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Puck"
                    }
                },
                languageCode: "es-US"
            },
            outputAudioTranscription: {},
            systemInstruction: {
                parts: [{ text: systemInstructionText }]
            },
        };

        const callbacks = {
            onopen: () => console.log('Google API session opened.'),
            onmessage: (message) => {
                // --- FIX: Correctly handle binary audio data vs. other messages ---
                if (ws.readyState !== ws.OPEN) return;

                // Audio frames come in as a Buffer. Convert them
                // to a real base-64 string and tag the payload.
                if (message.data) {
                    ws.send(JSON.stringify({
                        type: 'AUDIO',
                        data: Buffer.isBuffer(message.data)
                            ? message.data.toString('base64')
                            : message.data
                    }));
                }

                // Forward everything else (transcripts, turnComplete, etc.) unchanged.
                if (!message.data) {
                    ws.send(JSON.stringify(message));
                }
            },
            onerror: (e) => {
                console.error('Google API Error:', e);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ error: `Google API Error: ${e.message}` }));
                }
            },
            onclose: (e) => console.log('Google API session closed. Reason:', e ? e.reason : 'No reason provided.'),
        };

        console.log("Connecting to Gemini with config:", JSON.stringify(config, null, 2));

        const geminiSession = await ai.live.connect({
            model: MODEL_NAME,
            config,
            callbacks,
        });

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (geminiSession && data.audio) {
                    geminiSession.sendRealtimeInput({
                        audio: { data: data.audio.data, mimeType: `audio/pcm;rate=16000` }
                    });
                }
            } catch (error) {
                console.error("Failed to process message from client:", error);
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
            if (geminiSession) {
                geminiSession.close();
            }
        });

    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        ws.close(1011, 'Failed to initialize Gemini session.');
    }
});

server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});