import express from 'express';
import axios from 'axios';
import { createServer } from 'http';
import WebSocket from 'ws'; // Import default WebSocketServer
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import cors from 'cors';

const app = express();
const server = createServer(app); // HTTP server untuk Express + WebSocket
const wss = new WebSocket.WebSocketServer({ server }); // Fix: Gunakan WebSocket.WebSocketServer
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const tiktokUsername = process.env.TIKTOK_USERNAME || '@yourusername';

// State permainan
let targetWord = '';
let guesses = [];
let currentRow = 0;
const wordList = ['rumah', 'mobil', 'buku', 'meja', 'kursi', 'pintu', 'jendela', 'api', 'air', 'tanah'];

// Endpoint untuk start game baru
app.get('/api/new-game', (req, res) => {
    targetWord = wordList[Math.floor(Math.random() * wordList.length)];
    guesses = [];
    currentRow = 0;
    res.json({ status: 'Game started' });
    broadcastGameState();
});

// Endpoint validasi kata via KBBI
app.get('/api/validate-word/:word', async (req, res) => {
    const { word } = req.params;
    if (word.length !== 5) return res.json({ valid: false, message: 'Kata harus 5 huruf' });

    try {
        const response = await axios.get(`https://kbbi-api-amm.herokuapp.com/search?q=${word}`);
        const data = response.data;
        const isValid = data && data.teks && data.teks.length > 0;
        res.json({ valid: isValid, meaning: isValid ? data.teks : 'Kata tidak ditemukan di KBBI' });
    } catch (error) {
        console.error('KBBI API error:', error.message);
        res.json({ valid: false, message: 'Error API KBBI' });
    }
});

// Fallback polling endpoint
app.get('/api/game-state', (req, res) => {
    res.json({ guesses, currentRow });
});

// Broadcast state via WebSocket
function broadcastGameState() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', guesses, currentRow }));
        }
    });
}

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', content: message }));
        }
    });
}

// Proses tebakan dari TikTok
async function processGuess(guess, username) {
    if (currentRow >= 6 || !targetWord) return;

    const res = await axios.get(`http://localhost:${PORT}/api/validate-word/${guess}`);
    const { valid, meaning } = res.data;

    if (!valid) {
        broadcastMessage(`${username}: "${guess}" tidak valid di KBBI.`);
        return;
    }

    const guessResult = [];
    for (let i = 0; i < 5; i++) {
        if (guess[i] === targetWord[i]) {
            guessResult.push({ letter: guess[i], status: 'green' });
        } else if (targetWord.includes(guess[i])) {
            guessResult.push({ letter: guess[i], status: 'yellow' });
        } else {
            guessResult.push({ letter: guess[i], status: 'gray' });
        }
    }
    guesses.push({ word: guess, result: guessResult, username });
    currentRow++;

    broadcastGameState();

    if (guess === targetWord) {
        broadcastMessage(`Selamat! @${username} menebak kata: ${guess} (${meaning})`);
        targetWord = '';
    } else if (currentRow >= 6) {
        broadcastMessage(`Game over! Kata target: ${targetWord}`);
        targetWord = '';
    }
}

// TikTok LIVE Connector
const tiktokConnection = new TikTokLiveConnection(tiktokUsername, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
});

tiktokConnection.connect().then(state => {
    console.info(`Connected to TikTok LIVE roomId ${state.roomId}`);
}).catch(err => {
    console.error('Failed to connect to TikTok LIVE', err);
});

tiktokConnection.on(WebcastEvent.CHAT, async (data) => {
    const comment = data.comment.trim().toLowerCase();
    if (comment.length === 5 && /^[a-z]+$/.test(comment)) {
        console.log(`${data.user.uniqueId} commented: ${comment}`);
        await processGuess(comment, data.user.uniqueId);
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`Server + WebSocket running on port ${PORT}`);
});