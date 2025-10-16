import express from 'express';
import axios from 'axios';
import { createServer } from 'http'; // Import http untuk attach ws
import { Server } from 'ws'; // Ganti WebSocket.Server jadi Server
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import cors from 'cors';

const app = express();
const server = createServer(app); // Buat HTTP server dari Express
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' })); // CORS longgar untuk Canvas
app.use(express.json());

// Attach WebSocket ke HTTP server (satu port!)
const wss = new Server({ server }); // Attach ke server, bukan port terpisah

const tiktokUsername = process.env.TIKTOK_USERNAME || '@yourusername';

// State permainan
let targetWord = '';
let guesses = [];
let currentRow = 0;
const wordList = ['rumah', 'mobil', 'buku', 'meja', 'kursi', 'pintu', 'jendela', 'api', 'air', 'tanah'];

// Endpoint API (sama seperti sebelumnya)
app.get('/api/new-game', (req, res) => {
    targetWord = wordList[Math.floor(Math.random() * wordList.length)];
    guesses = [];
    currentRow = 0;
    res.json({ status: 'Game started' });
    broadcastGameState();
});

app.get('/api/validate-word/:word', async (req, res) => {
    const { word } = req.params;
    if (word.length !== 5) return res.json({ valid: false, message: 'Kata harus 5 huruf' });

    try {
        const response = await axios.get(`https://kbbi-api-amm.herokuapp.com/search?q=${word}`);
        const data = response.data;
        const isValid = data && data.teks && data.teks.length > 0;
        res.json({ valid: isValid, meaning: isValid ? data.teks : 'Kata tidak ditemukan di KBBI' });
    } catch (error) {
        res.json({ valid: false, message: 'Error API KBBI' });
    }
});

// Fallback Polling: Endpoint untuk cek state (jika WS gagal)
app.get('/api/game-state', (req, res) => {
    res.json({ guesses, currentRow });
});

// Broadcast via WebSocket
function broadcastGameState() {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', guesses, currentRow }));
        }
    });
}

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({ type: 'message', content: message }));
        }
    });
}

// Proses tebakan (sama)
async function processGuess(guess, username) {
    if (currentRow >= 6 || !targetWord) return;

    const res = await axios.get(`${req.protocol}://${req.get('host')}/api/validate-word/${guess}`); // Fix URL untuk Render
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

// TikTok Connector (sama)
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

// Jalankan server (satu port untuk HTTP + WS)
server.listen(PORT, () => {
    console.log(`Server + WebSocket running on port ${PORT}`);
});