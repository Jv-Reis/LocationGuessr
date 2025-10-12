require("dotenv").config();

// --- Configuração e Módulos ---
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const SERVER_GOOGLE_API_KEY = process.env.SERVER_GOOGLE_API_KEY;
const CLIENT_GOOGLE_API_KEY = process.env.CLIENT_GOOGLE_API_KEY;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Serve index.html e outros arquivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.use(express.static(path.join(__dirname, '../public')));

// Endpoint para fornecer a chave da API do cliente
app.get('/api/client-key', (req, res) => {
    res.json({ apiKey: CLIENT_GOOGLE_API_KEY });
});

const games = {};

// Implementação personalizada para cálculo de distância (não depende da API do Google Maps)
const google = { maps: { geometry: { spherical: { computeDistanceBetween: (from, to) => { const R = 6371e3; const φ1 = from.lat * Math.PI / 180; const φ2 = to.lat * Math.PI / 180; const Δφ = (to.lat - from.lat) * Math.PI / 180; const Δλ = (to.lng - from.lng) * Math.PI / 180; const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; } } } } };

async function getSingleLocation() {
    while (true) {
        try {
            const lat = Math.random() * 180 - 90;
            const lng = Math.random() * 360 - 180;
            const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=100000&source=outdoor&key=${SERVER_GOOGLE_API_KEY}`;
            const response = await axios.get(url);
            if (response.data.status === 'OK') {
                return response.data.location;
            }
        } catch (error) {
            console.error("Erro ao buscar local:", error.message);
        }
    }
}

// --- NOVO: Função de Cálculo de Pontos ---
function calculateRoundScore(distanceInKm, mapFactor = 2000) {
    if (distanceInKm * 1000 < 25) {
        return 5000;
    }
    const power = (-1 * distanceInKm) / mapFactor;
    const score = 5000 * Math.exp(power);
    if (score < 0) {
        return 0;
    }
    return Math.round(score);
}


// --- ALTERADO: Função para finalizar o round agora usa o novo sistema de pontos ---
// NO SEU ARQUIVO server.js, SUBSTITUA A FUNÇÃO endRound POR ESTA:

function endRound(gameId) {
    const game = games[gameId];
    if (!game || game.gameState !== 'IN_ROUND') return;

    if (game.roundTimerId) {
        clearTimeout(game.roundTimerId);
        game.roundTimerId = null;
    }

    game.gameState = 'ROUND_OVER';
    const correctLocation = game.locations[game.currentRound - 1];

    const roundResults = Object.values(game.players).map(p => {
        
        let roundPoints = 0;
        let distanceKm = Infinity; 
        const playerGuessed = p.currentGuess !== null;

        if (playerGuessed) {
            distanceKm = google.maps.geometry.spherical.computeDistanceBetween(p.currentGuess, correctLocation) / 1000;
            roundPoints = calculateRoundScore(distanceKm);
            p.totalScore += roundPoints; 
        } else {
            roundPoints = 0;
        }

        return {
            name: p.name,
            guess: p.currentGuess,
            distance: distanceKm,
            points: roundPoints,
            hasGuessed: playerGuessed 
        };
    });

    const overallStandings = Object.values(game.players)
        .sort((a, b) => b.totalScore - a.totalScore)
        .map(p => ({ name: p.name, totalScore: p.totalScore }));

    roundResults.sort((a, b) => b.points - a.points);
    
    Object.values(game.players).forEach(p => p.currentGuess = null);

    io.to(gameId).emit('roundResult', {
        roundResults: roundResults,
        overallStandings: overallStandings,
        correctLocation: correctLocation
    });
}

// --- Gerenciamento de Conexões (Socket.IO) ---
io.on('connection', (socket) => {
    console.log(`Novo jogador conectado: ${socket.id}`);

    socket.on('createGame', async (data) => {
        const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const numRounds = data.numRounds || 3;
        const roundTimeLimit = data.roundTimeLimit || 0;
        const locations = await Promise.all(Array.from({ length: numRounds }, () => getSingleLocation()));
        games[gameId] = {
            host: socket.id,
            players: {},
            locations: locations,
            currentRound: 0,
            gameState: 'LOBBY',
            roundTimeLimit: roundTimeLimit,
            roundTimerId: null
        };
        socket.emit('gameCreated', { gameId: gameId });
    });

    socket.on('joinGame', (data) => {
        const { gameId } = data;
        if (!games[gameId]) {
            return socket.emit('error', { message: 'Jogo não encontrado!' });
        }
        socket.join(gameId);
        games[gameId].players[socket.id] = {
            id: socket.id,
            name: `Jogador_${socket.id.substring(0, 4)}`,
            currentGuess: null,
            totalScore: 0 // Inicia com 0 pontos
        };
        io.to(gameId).emit('updatePlayerList', { players: Object.values(games[gameId].players) });
    });

    socket.on('setPlayerName', (data) => {
        const { gameId, playerName } = data;
        const game = games[gameId];
        const player = game ? game.players[socket.id] : null;
        if (player) {
            player.name = playerName && playerName.trim() ? playerName.trim().slice(0, 15) : 'Anônimo';
            io.to(gameId).emit('updatePlayerList', { players: Object.values(game.players) });
        }
    });

    socket.on('startGame', (data) => {
        const { gameId } = data;
        const game = games[gameId];
        if (game && game.host === socket.id && game.gameState === 'LOBBY') {
            game.gameState = 'IN_ROUND';
            game.currentRound = 1;
            io.to(gameId).emit('newRound', {
                round: game.currentRound,
                maxRounds: game.locations.length,
                location: game.locations[0],
                roundTimeLimit: game.roundTimeLimit
            });
            if (game.roundTimeLimit > 0) {
                game.roundTimerId = setTimeout(() => {
                    console.log(`Tempo esgotado para o jogo ${gameId}. Finalizando o round.`);
                    endRound(gameId);
                }, game.roundTimeLimit * 1000);
            }
        }
    });

    socket.on('submitGuess', (data) => {
        const { gameId, guess } = data;
        const game = games[gameId];
        if (!game) return;
        const player = game.players[socket.id];
        if (!player || game.gameState !== 'IN_ROUND') return;
        player.currentGuess = guess;
        io.to(gameId).emit('playerGuessed', { playerName: player.name });
        const allPlayersGuessed = Object.values(game.players).every(p => p.currentGuess !== null);
        if (allPlayersGuessed) {
            endRound(gameId);
        }
    });

    socket.on('requestNextRound', (data) => {
        const { gameId } = data;
        const game = games[gameId];
        if (game && game.gameState === 'ROUND_OVER') {
            if (game.currentRound < game.locations.length) {
                game.gameState = 'IN_ROUND';
                game.currentRound++;
                io.to(gameId).emit('newRound', {
                    round: game.currentRound,
                    maxRounds: game.locations.length,
                    location: game.locations[game.currentRound - 1],
                    roundTimeLimit: game.roundTimeLimit
                });
                if (game.roundTimeLimit > 0) {
                    game.roundTimerId = setTimeout(() => {
                        console.log(`Tempo esgotado para o jogo ${gameId}. Finalizando o round.`);
                        endRound(gameId);
                    }, game.roundTimeLimit * 1000);
                }
            } else {
                // ALTERADO: Ordena o resultado final pela pontuação (maior primeiro)
                const finalResults = Object.values(game.players).sort((a, b) => b.totalScore - a.totalScore);
                io.to(gameId).emit('gameOver', { results: finalResults });
                setTimeout(() => { delete games[gameId]; }, 60000);
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`Jogador desconectado: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}.`);
});