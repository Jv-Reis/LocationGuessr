// Lógica de sala/jogador sem estado em memória — lê e escreve direto no Supabase.
// Pensada pra virar rota HTTP (Express agora, Vercel function depois) sem precisar
// reescrever a lógica de novo: cada função aqui recebe dados simples e devolve
// dados simples, sem acoplamento com req/res.
const supabase = require('./supabaseClient');
const { REGIONS, getSingleLocation, getVideoRoundSet } = require('./locations');
const { clampNumRounds, clampRoundTimeLimit, isValidGuess } = require('./validation');
const { calculateRoundScore, haversineDistanceKm } = require('./scoring');

const POSTGRES_UNIQUE_VIOLATION = '23505';
const MAX_CODE_ATTEMPTS = 5;

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function assertSupabaseConfigured() {
    if (!supabase) {
        throw new Error('Supabase não configurado — defina SUPABASE_URL e SUPABASE_SECRET_KEY em backend/.env.');
    }
}

function computeRoundDeadline(roundTimeLimit) {
    if (!roundTimeLimit || roundTimeLimit <= 0) return null;
    return new Date(Date.now() + roundTimeLimit * 1000).toISOString();
}

// Troca de estado com trava otimista: só aplica os `updates` se a sala ainda
// estiver em `fromState` (evita duas chamadas concorrentes processarem a
// mesma transição duas vezes — ex.: round-timeout e "todo mundo chutou" ao
// mesmo tempo). Devolve true se essa chamada foi quem "ganhou" a corrida.
async function tryTransitionGameState(gameId, fromState, updates) {
    const { data, error } = await supabase
        .from('games')
        .update(updates)
        .eq('id', gameId)
        .eq('game_state', fromState)
        .select();
    if (error) throw new Error(`Falha ao atualizar sala: ${error.message}`);
    return !!(data && data.length > 0);
}

async function createGame({ numRounds, roundTimeLimit, region, gameMode, restrictMovement, hostClientId }) {
    assertSupabaseConfigured();
    if (!hostClientId) throw new Error('hostClientId é obrigatório.');

    const clampedRounds = clampNumRounds(numRounds);
    const clampedTimeLimit = clampRoundTimeLimit(roundTimeLimit);
    const resolvedRegion = REGIONS[region] ? region : 'world';
    const resolvedMode = gameMode === 'video' ? 'video' : 'streetview';
    const resolvedRestrictMovement = resolvedMode === 'streetview' && !!restrictMovement;

    let locations;
    if (resolvedMode === 'video') {
        locations = await getVideoRoundSet(resolvedRegion, clampedRounds);
        if (locations.length === 0) {
            throw new Error('Nenhum vídeo disponível para essa região no momento.');
        }
    } else {
        locations = await Promise.all(
            Array.from({ length: clampedRounds }, () => getSingleLocation(resolvedRegion))
        );
    }

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
        const gameId = generateGameCode();
        const { error: gameError } = await supabase.from('games').insert({
            id: gameId,
            host_client_id: hostClientId,
            game_state: 'LOBBY',
            current_round: 0,
            region: resolvedRegion,
            region_label: REGIONS[resolvedRegion].label,
            game_mode: resolvedMode,
            restrict_movement: resolvedRestrictMovement,
            round_time_limit: clampedTimeLimit,
            locations
        });

        if (gameError) {
            if (gameError.code === POSTGRES_UNIQUE_VIOLATION) continue; // código já existe, tenta outro
            throw new Error(`Falha ao criar sala: ${gameError.message}`);
        }

        const { error: playerError } = await supabase.from('players').insert({
            game_id: gameId,
            client_id: hostClientId,
            name: 'Anônimo',
            is_host: true
        });
        if (playerError) throw new Error(`Falha ao adicionar host: ${playerError.message}`);

        return { gameId };
    }

    throw new Error('Não foi possível gerar um código de sala único. Tente novamente.');
}

async function getGameState(gameId) {
    assertSupabaseConfigured();
    const { data: game, error: gameError } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
    if (gameError) throw new Error(`Falha ao buscar sala: ${gameError.message}`);
    if (!game) return null;

    const { data: players, error: playersError } = await supabase
        .from('players').select('*').eq('game_id', gameId).order('connected_at', { ascending: true });
    if (playersError) throw new Error(`Falha ao buscar jogadores: ${playersError.message}`);

    return { game, players: players || [] };
}

async function joinGame({ gameId, clientId }) {
    assertSupabaseConfigured();
    if (!clientId) throw new Error('clientId é obrigatório.');

    const state = await getGameState(gameId);
    if (!state) throw new Error('Jogo não encontrado!');

    const alreadyIn = state.players.some(p => p.client_id === clientId);
    if (!alreadyIn) {
        const { error } = await supabase.from('players').insert({
            game_id: gameId,
            client_id: clientId,
            name: 'Anônimo',
            is_host: state.game.host_client_id === clientId
        });
        if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) {
            throw new Error(`Falha ao entrar na sala: ${error.message}`);
        }
    }

    return getGameState(gameId);
}

async function setPlayerName({ gameId, clientId, name }) {
    assertSupabaseConfigured();
    const cleanName = name && name.trim() ? name.trim().slice(0, 15) : 'Anônimo';

    const { error } = await supabase
        .from('players')
        .update({ name: cleanName })
        .eq('game_id', gameId)
        .eq('client_id', clientId);
    if (error) throw new Error(`Falha ao atualizar nome: ${error.message}`);

    return getGameState(gameId);
}

async function startGame({ gameId, clientId }) {
    assertSupabaseConfigured();
    const state = await getGameState(gameId);
    if (!state) throw new Error('Jogo não encontrado!');
    if (state.game.host_client_id !== clientId) throw new Error('Só o host pode iniciar a partida.');

    if (state.game.game_state === 'LOBBY') {
        await tryTransitionGameState(gameId, 'LOBBY', {
            game_state: 'IN_ROUND',
            current_round: 1,
            round_deadline: computeRoundDeadline(state.game.round_time_limit)
        });
    }
    return getGameState(gameId);
}

async function submitGuess({ gameId, clientId, guess }) {
    assertSupabaseConfigured();
    if (!isValidGuess(guess)) throw new Error('Palpite inválido.');

    const state = await getGameState(gameId);
    if (!state) throw new Error('Jogo não encontrado!');
    if (state.game.game_state !== 'IN_ROUND') throw new Error('Não é possível chutar agora.');

    const { error } = await supabase
        .from('players')
        .update({ current_guess: guess })
        .eq('game_id', gameId)
        .eq('client_id', clientId);
    if (error) throw new Error(`Falha ao registrar palpite: ${error.message}`);

    const updated = await getGameState(gameId);
    const allGuessed = updated.players.length > 0 && updated.players.every(p => p.current_guess !== null);
    if (allGuessed) {
        return endRound(gameId);
    }
    return updated;
}

// Calcula a pontuação do round e vira ROUND_OVER. Protegida por trava otimista —
// pode ser chamada tanto por submitGuess (todo mundo já chutou) quanto por
// roundTimeout (tempo acabou); só quem "ganhar" a corrida processa de verdade.
async function endRound(gameId) {
    assertSupabaseConfigured();
    const state = await getGameState(gameId);
    if (!state || state.game.game_state !== 'IN_ROUND') return state;

    const correctLocation = state.game.locations[state.game.current_round - 1];

    // Calcula tudo primeiro (não mexe no banco ainda) — só depois disputa a trava.
    const roundResults = state.players.map(player => {
        const hasGuessed = player.current_guess !== null;
        let distanceKm = null;
        let points = 0;
        if (hasGuessed) {
            distanceKm = haversineDistanceKm(player.current_guess, correctLocation);
            points = calculateRoundScore(distanceKm);
        }
        return { clientId: player.client_id, name: player.name, guess: player.current_guess, distanceKm, points, hasGuessed };
    });

    // Trava otimista: reivindica o fim do round SEM ainda anexar o resultado —
    // isso evita que outra chamada concorrente reprocesse o mesmo round (ex.:
    // round-timeout e "todo mundo chutou" quase juntos). Só quem ganhar a
    // corrida segue e aplica as pontuações.
    const claimed = await tryTransitionGameState(gameId, 'IN_ROUND', {
        game_state: 'ROUND_OVER',
        round_deadline: null
    });
    if (!claimed) return getGameState(gameId); // outra chamada já processou este round

    for (const result of roundResults) {
        const player = state.players.find(p => p.client_id === result.clientId);
        const { error } = await supabase
            .from('players')
            .update({ total_score: player.total_score + result.points, current_guess: null })
            .eq('game_id', gameId)
            .eq('client_id', result.clientId);
        if (error) throw new Error(`Falha ao atualizar pontuação: ${error.message}`);
    }

    // Só agora, com as pontuações já aplicadas, anexa o resultado na sala — é
    // esse campo que o cliente espera antes de desenhar a tela de resultado (ver
    // applyState no game.js), então ele só fica visível quando os placares já
    // estiverem consistentes. Sem isso, um cliente reagindo rápido ao Realtime
    // logo depois do game_state virar ROUND_OVER poderia ler os placares
    // antigos, de antes da pontuação deste round ser somada.
    const { error: resultsError } = await supabase
        .from('games')
        .update({ last_round_results: roundResults })
        .eq('id', gameId);
    if (resultsError) throw new Error(`Falha ao salvar resultado do round: ${resultsError.message}`);

    const finalState = await getGameState(gameId);
    return { ...finalState, roundResults, correctLocation };
}

// Chamado pelo cliente quando o timer local dele zera. Idempotente — se o round
// já tiver sido encerrado (por outro jogador chutando por último, por exemplo),
// não faz nada.
async function roundTimeout({ gameId }) {
    assertSupabaseConfigured();
    return endRound(gameId);
}

async function requestNextRound({ gameId, clientId }) {
    assertSupabaseConfigured();
    const state = await getGameState(gameId);
    if (!state) throw new Error('Jogo não encontrado!');
    if (state.game.host_client_id !== clientId) throw new Error('Só o host pode avançar o round.');

    if (state.game.game_state === 'ROUND_OVER') {
        const totalRounds = state.game.locations.length;
        if (state.game.current_round < totalRounds) {
            await tryTransitionGameState(gameId, 'ROUND_OVER', {
                game_state: 'IN_ROUND',
                current_round: state.game.current_round + 1,
                round_deadline: computeRoundDeadline(state.game.round_time_limit)
            });
        } else {
            await tryTransitionGameState(gameId, 'ROUND_OVER', { game_state: 'GAME_OVER' });
        }
    }
    return getGameState(gameId);
}

module.exports = {
    createGame, getGameState, joinGame, setPlayerName,
    startGame, submitGuess, roundTimeout, requestNextRound
};
