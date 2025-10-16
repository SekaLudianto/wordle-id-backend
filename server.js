import express from 'express';
import axios from 'axios';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import WebSocket from 'ws';
import cors from 'cors'; // Tambah CORS untuk akses dari Canvas

const app = express();
app.use(cors()); // Izinkan akses dari Google AI Studio
app.use(express.json());
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: process.env.PORT_WS || 10000 });
const tiktokUsername = process.env.TIKTOK_USERNAME || '@yourusername'; // Set di Render env

// Simpan state permainan
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
        res.json({ valid: false, message: 'Error API KBBI' });
    }
});

// Broadcast state ke frontend
function broadcastGameState() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', guesses, currentRow }));
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

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', content: message }));
        }
    });
}

// Koneksi TikTok LIVE
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

app.listen(PORT, () => console.log(`Server on port ${PORT}`));