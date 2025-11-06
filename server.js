const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Modality } = require('@google/genai');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const MODEL_NAME = "gemini-2.5-flash-preview-native-audio-dialog";
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
const systemInstructionText = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');

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

        let audioSequence = 0;

        const callbacks = {
            onopen: () => console.log('Google API session opened.'),
            onmessage: (message) => {
                if (ws.readyState !== ws.OPEN) return;

                try {
                    if (message?.data) {
                        const base64Audio = toBase64Audio(message.data);
                        if (base64Audio) {
                            ws.send(JSON.stringify({
                                type: 'AUDIO',
                                data: base64Audio,
                                sequence: audioSequence++
                            }));
                        }
                    }

                    if (message?.serverContent) {
                        ws.send(JSON.stringify({
                            type: 'SERVER_CONTENT',
                            serverContent: message.serverContent
                        }));
                    }

                    if (message?.error) {
                        ws.send(JSON.stringify({
                            type: 'ERROR',
                            errorType: 'MODEL',
                            message: message.error.message || 'Google API error'
                        }));
                    }
                } catch (forwardError) {
                    console.error('Failed to forward Gemini message:', forwardError);
                }
            },
            onerror: (e) => {
                console.error('Google API Error:', e);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        errorType: 'MODEL',
                        message: 'Google API Error'
                    }));
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
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                errorType: 'MODEL_INIT',
                message: 'Failed to initialize Gemini session.'
            }));
        }
        ws.close(1011, 'Failed to initialize Gemini session.');
    }
});

server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});

function toBase64Audio(data) {
    if (!data) return null;
    if (Buffer.isBuffer(data)) {
        return data.toString('base64');
    }
    if (typeof data === 'string') {
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('base64');
    }
    return null;
}
