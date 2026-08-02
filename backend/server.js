// --- Configuração e Módulos ---
require('dotenv').config();
const express = require('express');
const path = require('path');
const gameService = require('./gameService');

// Chave usada pelo servidor para chamar a Street View Metadata API (mantida em segredo).
const GOOGLE_MAPS_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
// Chave entregue ao navegador para carregar a Maps JavaScript API — deve ser restrita
// por HTTP referrer no Google Cloud Console, pois fica visível a qualquer visitante.
const GOOGLE_MAPS_CLIENT_KEY = process.env.GOOGLE_MAPS_CLIENT_KEY;
// Opcional: habilita busca ao vivo de vídeos no modo Vídeo Guesser. Sem ela, o modo
// usa só o pool fixo em videos.json. Precisa da "YouTube Data API v3" no Cloud Console.
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || null;
// URL e publishable key do Supabase — vão pro navegador (RLS protege a escrita,
// só a secret key do servidor consegue gravar).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!GOOGLE_MAPS_SERVER_KEY || !GOOGLE_MAPS_CLIENT_KEY) {
    console.error("ERRO: defina GOOGLE_MAPS_SERVER_KEY e GOOGLE_MAPS_CLIENT_KEY em backend/.env (veja .env.example).");
    process.exit(1);
}
if (!YOUTUBE_API_KEY) {
    console.log("Aviso: YOUTUBE_API_KEY não definida — o modo Vídeo Guesser vai usar só o pool fixo em videos.json.");
}
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error("ERRO: defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em backend/.env (veja .env.example).");
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// game.html sem game/screen não corresponde a nenhuma tela válida — o menu
// principal é a landing page (index.html), então redireciona pra lá.
app.get('/game.html', (req, res, next) => {
    const hasEntryParam = req.query.game || req.query.screen;
    if (!hasEntryParam) {
        return res.redirect('/');
    }
    next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Expõe só as chaves restritas/públicas para o frontend, nunca as chaves de servidor
app.get('/api/config', (req, res) => {
    res.json({
        googleMapsKey: GOOGLE_MAPS_CLIENT_KEY,
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY
    });
});

// --- Rotas do jogo ---
// Stateless: cada rota lê/escreve só no Supabase (via gameService) e devolve o
// estado atual; o navegador assina o Supabase Realtime pra saber quando algo
// mudou (ver public/game.js). Nenhum estado de partida fica em memória do
// servidor, então isso roda igual num processo Node persistente ou numa
// função serverless (Vercel).
const CREATE_GAME_COOLDOWN_MS = 3000;
const lastCreateGameAtByClient = new Map(); // freio simples contra spam de criação de sala

app.post('/api/rest/games', async (req, res) => {
    try {
        const { numRounds, roundTimeLimit, region, gameMode, restrictMovement, hostClientId } = req.body || {};

        const now = Date.now();
        const lastAt = lastCreateGameAtByClient.get(hostClientId);
        if (lastAt && now - lastAt < CREATE_GAME_COOLDOWN_MS) {
            return res.status(429).json({ message: 'Aguarde um momento antes de criar outra sala.' });
        }
        lastCreateGameAtByClient.set(hostClientId, now);

        const result = await gameService.createGame({ numRounds, roundTimeLimit, region, gameMode, restrictMovement, hostClientId });
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/api/rest/games/:id/join', async (req, res) => {
    try {
        const { clientId } = req.body || {};
        const result = await gameService.joinGame({ gameId: req.params.id, clientId });
        res.json(result);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
});

app.get('/api/rest/games/:id', async (req, res) => {
    try {
        const result = await gameService.getGameState(req.params.id);
        if (!result) return res.status(404).json({ message: 'Jogo não encontrado!' });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.patch('/api/rest/games/:id/player', async (req, res) => {
    try {
        const { clientId, name } = req.body || {};
        const result = await gameService.setPlayerName({ gameId: req.params.id, clientId, name });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/api/rest/games/:id/start', async (req, res) => {
    try {
        const { clientId } = req.body || {};
        const result = await gameService.startGame({ gameId: req.params.id, clientId });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/api/rest/games/:id/guess', async (req, res) => {
    try {
        const { clientId, guess } = req.body || {};
        const result = await gameService.submitGuess({ gameId: req.params.id, clientId, guess });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/api/rest/games/:id/round-timeout', async (req, res) => {
    try {
        const result = await gameService.roundTimeout({ gameId: req.params.id });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/api/rest/games/:id/next-round', async (req, res) => {
    try {
        const { clientId } = req.body || {};
        const result = await gameService.requestNextRound({ gameId: req.params.id, clientId });
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Só sobe um servidor HTTP de verdade quando rodado direto (node server.js,
// npm start). Na Vercel, esse arquivo é importado por api/index.js e a própria
// Vercel chama `app` como função serverless a cada requisição — sem isso, o
// app.listen ficaria pendurado tentando abrir uma porta dentro da função.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}.`);
    });
}

module.exports = app;
