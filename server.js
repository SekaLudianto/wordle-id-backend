import express from 'express';
import { createServer } from 'http';
import WebSocket from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocket.WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const tiktokUsername = process.env.TIKTOK_USERNAME || '@yourusername';
const sessionId = process.env.TIKTOK_SESSION_ID || null;
const ttTargetIdc = process.env.TIKTOK_TT_TARGET_IDC || null;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'Server running' });
});

// TikTok LIVE Connector
const tiktokConnection = new TikTokLiveConnection(tiktokUsername, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    sessionId,
    ttTargetIdc,
    authenticateWs: sessionId && ttTargetIdc ? true : false,
});

tiktokConnection.connect().then(state => {
    console.info(`Connected to TikTok LIVE roomId ${state.roomId}`);
}).catch(err => {
    console.error('Failed to connect to TikTok LIVE', err);
});

// Dengarkan komentar TikTok
tiktokConnection.on(WebcastEvent.CHAT, async (data) => {
    const rawComment = data.comment.trim().toLowerCase();
    console.log(`Raw comment received: "${rawComment}" from ${data.user.uniqueId}`);
    const comment = rawComment.replace(/[^a-z]/g, '').slice(0, 5);
    if (comment.length === 5) {
        console.log(`Valid comment: "${comment}" from ${data.user.uniqueId}`);
        // Kirim ke frontend via WebSocket
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'comment',
                    word: comment,
                    username: data.user.uniqueId
                }));
            }
        });
        // (Opsional) Kirim feedback ke TikTok
        if (sessionId && ttTargetIdc) {
            try {
                await tiktokConnection.sendMessage(`@${data.user.uniqueId}: Tebakan "${comment}" diterima!`);
            } catch (error) {
                console.error(`Failed to send TikTok message: ${error.message}`);
            }
        }
    } else {
        console.log(`Comment "${rawComment}" rejected: Not 5 letters after cleaning`);
    }
});

// Reconnect jika TikTok putus
tiktokConnection.on('disconnected', () => {
    console.log('TikTok WebSocket disconnected, reconnecting...');
    setTimeout(() => tiktokConnection.connect(), 5000);
});

// Start server
server.listen(PORT, () => {
    console.log(`Server + WebSocket running on port ${PORT}`);
});