// --- Elementos da UI ---
const menuContainer = document.getElementById('menu-container');
const lobbyMenu = document.getElementById('lobby-menu');
const inGameUI = document.getElementById('in-game-ui');
const gameLinkInput = document.getElementById('game-link-input');
const lobbyPlayersList = document.getElementById('lobby-players');
const startGameBtn = document.getElementById('start-game-btn');
const panoElement = document.getElementById("pano");
const mapContainer = document.getElementById("map-container");
const guessBtn = document.getElementById('guess-btn');
const nextRoundBtn = document.getElementById('next-round-btn');
const roundDisplay = document.getElementById("round-display");
const resultText = document.getElementById("result-text");
const playerNameInput = document.getElementById('player-name-input');
const confirmNameBtn = document.getElementById('confirm-name-btn');
const namePrompt = document.getElementById('name-prompt');
const playerListSection = document.getElementById('player-list-section');
const roundResultContainer = document.getElementById('round-result-container');
const gameStatusHUD = document.getElementById('game-status-hud');
const timerDisplay = document.getElementById('timer-display');

const classicSetupMenu = document.getElementById('classic-setup-menu');
const videoSetupMenu = document.getElementById('video-setup-menu');
const joinRoomMenu = document.getElementById('join-room-menu');
const joinCodeInput = document.getElementById('join-code-input');
const confirmJoinBtn = document.getElementById('confirm-join-btn');
const backFromJoinBtn = document.getElementById('back-from-join-btn');
const joinErrorMsg = document.getElementById('join-error-msg');

// --- Variáveis de estado do Jogo ---

// clientId persistente: é o que identifica "quem eu sou" pro backend — não existe
// mais conexão de socket, então isso substitui o antigo socket.id.
if (!localStorage.getItem('lg_clientId')) {
    localStorage.setItem('lg_clientId', Math.random().toString(36).substring(2) + Date.now().toString(36));
}
const clientId = localStorage.getItem('lg_clientId');

let hasInitialized = false;
let map, panorama, isHost = false, guessedLocation = null, myPlayerName = '';
let countdownInterval = null;
let guessMarker, correctMarker, playerMarkers = [], lines = [];
let roundTimerInterval = null;
let timeLeft = 0;
let activeCreateBtn = null; // botão "Confirmar e Criar Sala" da tela de setup ativa (clássico ou vídeo)
let currentGameId = null;
let realtimeChannel = null;
let lastRenderedKey = null; // evita re-renderizar a mesma transição de round mais de uma vez

// --- Chamadas REST (substituem os antigos socket.emit) ---
async function apiRequest(method, path, body) {
    const res = await fetch(`/api/rest/games${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Erro inesperado.');
    return data;
}

// --- Funções do Timer ---
function startTimerFromDeadline(deadlineIso) {
    const secondsLeft = Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000);
    startTimer(Math.max(secondsLeft, 0));
}

function startTimer(seconds) {
    if (roundTimerInterval) clearInterval(roundTimerInterval);
    timeLeft = seconds;
    updateTimerDisplay();
    roundTimerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        if (timeLeft <= 0) handleTimeUp();
    }, 1000);
}

function stopTimer() {
    if (roundTimerInterval) {
        clearInterval(roundTimerInterval);
        roundTimerInterval = null;
    }
}

function updateTimerDisplay() {
    if (!timerDisplay) return;
    if (timeLeft <= 0) {
        timerDisplay.textContent = "00:00";
        return;
    }
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function handleTimeUp() {
    stopTimer();
    guessBtn.disabled = true;
    resultText.style.display = 'block';
    resultText.innerHTML = "Tempo esgotado! Aguardando o resultado...";
    // Qualquer jogador pode disparar — é idempotente no servidor (só quem chegar
    // primeiro processa o round; os outros não fazem nada).
    apiRequest('POST', `/${currentGameId}/round-timeout`).catch(() => {});
}


// --- Contagem Regressiva ---
function startCountdown(onComplete) {
    const overlay = document.getElementById('countdown-overlay');
    const numberEl = document.getElementById('countdown-number');
    let count = 3;

    overlay.style.display = 'flex';
    numberEl.className = '';
    numberEl.textContent = count;
    void numberEl.offsetWidth;
    numberEl.className = 'pop';

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        count--;
        numberEl.className = '';
        void numberEl.offsetWidth;
        if (count > 0) {
            numberEl.textContent = count;
            numberEl.className = 'pop';
        } else if (count === 0) {
            numberEl.textContent = 'Adivinhe!';
            numberEl.className = 'pop go';
        } else {
            clearInterval(countdownInterval);
            overlay.style.display = 'none';
            onComplete();
        }
    }, 900);
}

// --- Bússola ---
function updateCompass(heading) {
    const needle = document.getElementById('compass-needle-wrap');
    if (needle) needle.style.transform = `rotate(${heading}deg)`;
}

// --- Renderiza a cena do round: Street View (Clássico) ou vídeo do YouTube (Vídeo Guesser) ---
function renderRoundMedia(data) {
    const compassEl = document.getElementById('compass');
    panoElement.innerHTML = '';

    if (data.location && data.location.videoId) {
        panorama = null;
        if (compassEl) compassEl.style.display = 'none';

        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.overflow = 'hidden';

        const iframe = document.createElement('iframe');
        iframe.id = 'video-player';
        iframe.width = '100%';
        iframe.height = '100%';
        iframe.style.border = '0';
        iframe.style.pointerEvents = 'none'; // impede pausar/revelar controles clicando no vídeo
        iframe.allow = 'autoplay; encrypted-media';
        // mute=1 garante que o autoplay não seja bloqueado pelo navegador — se o vídeo
        // ficasse pausado no carregamento, o próprio player do YouTube mostraria o
        // título por cima da imagem, entregando a resposta.
        // start= pula a abertura/recapitulação do vídeo (onde normalmente aparecem textos
        // e prévias que entregam o local), calculado no servidor pra cada vídeo.
        const startSeconds = data.location.startSeconds || 0;
        iframe.src = `https://www.youtube-nocookie.com/embed/${data.location.videoId}` +
            `?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&start=${startSeconds}`;

        // Barra de segurança: cobre a faixa onde o YouTube exibe o título do vídeo
        // (aparece brevemente no carregamento ou se o player pausar por algum motivo).
        const titleCover = document.createElement('div');
        titleCover.id = 'video-title-cover';

        wrapper.appendChild(iframe);
        wrapper.appendChild(titleCover);
        panoElement.appendChild(wrapper);
        return;
    }

    panorama = new google.maps.StreetViewPanorama(panoElement, {
        position: data.location,
        addressControl: false,
        showRoadLabels: false,
        zoomControl: true,
        linksControl: !data.restrictMovement,
        clickToGo: !data.restrictMovement,
        pov: { heading: 270, pitch: 0 },
    });
    if (compassEl) compassEl.style.display = 'block';
    panorama.addListener('pov_changed', () => updateCompass(panorama.getPov().heading));
}

// Liga os controles (steppers, toggle de tempo, criar sala, voltar) de uma tela de
// configuração. Clássico e Vídeo Guesser reaproveitam a mesma lógica, só mudam o
// prefixo dos ids, o modo fixo e se tem a opção "Sem Mover".
function wireSetupScreen({ prefix, gameMode, hasRestrictMovement }) {
    const regionSelect = document.getElementById(`${prefix}-region-select`);
    const roundsInput = document.getElementById(`${prefix}-rounds-input`);
    const timeInput = document.getElementById(`${prefix}-time-input`);
    const timeToggleCheckbox = document.getElementById(`${prefix}-time-toggle-checkbox`);
    const timeSelectorContainer = document.getElementById(`${prefix}-time-selector-container`);
    const createBtn = document.getElementById(`${prefix}-create-game-btn`);
    const backBtn = document.getElementById(`${prefix}-back-btn`);
    const restrictMovementCheckbox = hasRestrictMovement
        ? document.getElementById(`${prefix}-restrict-movement-checkbox`)
        : null;

    document.getElementById(`${prefix}-rounds-decrement`).addEventListener('click', () => roundsInput.stepDown());
    document.getElementById(`${prefix}-rounds-increment`).addEventListener('click', () => roundsInput.stepUp());
    document.getElementById(`${prefix}-time-decrement`).addEventListener('click', () => timeInput.stepDown());
    document.getElementById(`${prefix}-time-increment`).addEventListener('click', () => timeInput.stepUp());

    timeToggleCheckbox.addEventListener('change', () => {
        timeSelectorContainer.style.display = timeToggleCheckbox.checked ? 'none' : 'flex';
    });

    backBtn.addEventListener('click', () => {
        window.location.href = '/';
    });

    createBtn.addEventListener('click', async () => {
        activeCreateBtn = createBtn;
        createBtn.disabled = true;
        createBtn.textContent = 'Criando...';
        const numRounds = parseInt(roundsInput.value, 10);
        const roundTimeLimit = timeToggleCheckbox.checked ? 0 : parseInt(timeInput.value, 10);

        try {
            const { gameId } = await apiRequest('POST', '', {
                numRounds,
                roundTimeLimit,
                region: regionSelect.value,
                gameMode,
                restrictMovement: restrictMovementCheckbox ? restrictMovementCheckbox.checked : false,
                hostClientId: clientId
            });

            const newUrl = window.location.pathname + `?game=${gameId}`;
            history.pushState(null, '', newUrl);
            localStorage.setItem('lg_gameId', gameId);
            classicSetupMenu.style.display = 'none';
            videoSetupMenu.style.display = 'none';
            await enterGame(gameId);
        } catch (error) {
            createBtn.disabled = false;
            createBtn.textContent = 'Confirmar e Criar Sala';
            alert(error.message);
        }
    });
}

// --- Assina as mudanças da sala no Supabase Realtime (substitui os antigos
// socket.on('newRound'/'roundResult'/'updatePlayerList'/...)) ---
function subscribeToGame(gameId) {
    if (realtimeChannel) {
        window.supabaseClient.removeChannel(realtimeChannel);
    }
    const refetchAndApply = () => {
        apiRequest('GET', `/${gameId}`).then(applyState).catch(() => {});
    };
    realtimeChannel = window.supabaseClient
        .channel(`game-${gameId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, refetchAndApply)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, refetchAndApply)
        .subscribe();
}

// Ponto único de renderização: recebe o estado atual (sala + jogadores) e decide
// o que mostrar. Toda mudança — minha ou de outro jogador — passa por aqui.
function applyState(state) {
    if (!state || !state.game) return;
    const { game, players } = state;
    currentGameId = game.id;
    isHost = game.host_client_id === clientId;

    const me = players.find(p => p.client_id === clientId);
    if (me && me.name && me.name !== 'Anônimo') myPlayerName = me.name;

    if (game.game_state === 'LOBBY') {
        renderLobby(game, players, me);
    } else if (game.game_state === 'IN_ROUND') {
        const key = `round:${game.id}:${game.current_round}`;
        if (key !== lastRenderedKey) {
            lastRenderedKey = key;
            enterRound(game);
        }
    } else if (game.game_state === 'ROUND_OVER' && game.last_round_results) {
        // O servidor só anexa last_round_results depois de já ter aplicado a
        // pontuação de todo mundo (ver endRound em gameService.js) — se ainda não
        // chegou, é sinal de que pegamos o estado no meio do processamento; melhor
        // esperar a próxima atualização do que desenhar placares desatualizados.
        const key = `over:${game.id}:${game.current_round}`;
        if (key !== lastRenderedKey) {
            lastRenderedKey = key;
            renderRoundResult(game, players);
        }
    } else if (game.game_state === 'GAME_OVER') {
        const key = `gameover:${game.id}`;
        if (key !== lastRenderedKey) {
            lastRenderedKey = key;
            renderGameOver(players);
        }
    }
}

function renderLobby(game, players, me) {
    menuContainer.style.display = 'flex';
    lobbyMenu.style.display = 'block';
    inGameUI.style.display = 'none';
    mapContainer.style.display = 'none';
    roundResultContainer.style.display = 'none';
    gameLinkInput.value = game.id;

    const hasName = me && me.name && me.name !== 'Anônimo';
    namePrompt.style.display = hasName ? 'none' : 'block';
    playerListSection.style.display = hasName ? 'block' : 'none';
    startGameBtn.style.display = (isHost && hasName) ? 'block' : 'none';

    lobbyPlayersList.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name + (player.client_id === clientId ? ' (Você)' : '');
        lobbyPlayersList.appendChild(li);
    });
}

function enterRound(game) {
    const transition = document.getElementById('round-transition');
    transition.classList.add('visible');

    setTimeout(() => {
        menuContainer.style.display = 'none';
        inGameUI.style.display = 'block';
        mapContainer.style.display = 'block';
        gameStatusHUD.style.display = 'block';
        roundResultContainer.style.display = 'none';
        guessBtn.style.display = 'block';
        guessBtn.disabled = true; // liberado após contagem
        nextRoundBtn.style.display = 'none';
        resultText.style.display = 'none';
        guessedLocation = null;

        if (guessMarker) guessMarker.setMap(null);
        if (correctMarker) correctMarker.setMap(null);
        playerMarkers.forEach(m => m.setMap(null));
        lines.forEach(l => l.setMap(null));
        playerMarkers = [];
        lines = [];

        stopTimer();
        timerDisplay.textContent = game.round_time_limit > 0 ? '--:--' : '∞';

        roundDisplay.textContent = `Round ${game.current_round} / ${game.locations.length}`;
        const regionDisplay = document.getElementById('region-display');
        if (regionDisplay) regionDisplay.textContent = game.region_label;
        document.getElementById('round-results-display').innerHTML = '';
        document.getElementById('overall-standings-display').innerHTML = '';

        renderRoundMedia({
            location: game.locations[game.current_round - 1],
            restrictMovement: game.restrict_movement
        });

        // 3. Fade de volta
        setTimeout(() => {
            transition.classList.remove('visible');

            // 4. Contagem regressiva → libera o jogo
            startCountdown(() => {
                guessBtn.disabled = false;
                if (game.round_deadline) startTimerFromDeadline(game.round_deadline);
            });
        }, 350);
    }, 350);
}

function renderRoundResult(game, players) {
    stopTimer();
    guessBtn.style.display = 'none';
    resultText.style.display = 'none';
    gameStatusHUD.style.display = 'none';
    roundResultContainer.style.display = 'flex';
    nextRoundBtn.style.display = isHost ? 'block' : 'none';
    document.getElementById('compass').style.display = 'none';

    playerMarkers.forEach(m => m.setMap(null));
    lines.forEach(l => l.setMap(null));
    playerMarkers = [];
    lines = [];

    const correctLocation = game.locations[game.current_round - 1];
    const roundResults = [...(game.last_round_results || [])].sort((a, b) => b.points - a.points);

    correctMarker = new google.maps.Marker({
        position: correctLocation,
        map: map,
        icon: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png'
    });

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(correctLocation);

    // Marcadores e linhas no mapa
    const lineColors = ['#14B8A6', '#FF6B57', '#FBBF24', '#8B5CF6', '#38BDF8'];
    roundResults.forEach((playerResult, index) => {
        if (playerResult.hasGuessed && playerResult.guess) {
            const playerGuessMarker = new google.maps.Marker({
                position: playerResult.guess,
                map: map,
                label: { text: playerResult.name.substring(0, 3), color: '#fff', fontWeight: 'bold' }
            });
            playerMarkers.push(playerGuessMarker);
            const line = new google.maps.Polyline({
                path: [playerResult.guess, correctLocation],
                map: map,
                strokeColor: lineColors[index % lineColors.length],
                strokeWeight: 2
            });
            lines.push(line);
            bounds.extend(playerResult.guess);
        }
    });
    map.fitBounds(bounds);

    // --- Cards de resultado ---
    const medals = ['🥇', '🥈', '🥉'];
    const resultsDisplay = document.getElementById('round-results-display');
    const standingsDisplay = document.getElementById('overall-standings-display');

    resultsDisplay.innerHTML = '<p class="result-section-title">Resultado do Round</p>';

    roundResults.forEach((playerResult, index) => {
        const isYou = playerResult.clientId === clientId;
        const rank = medals[index] || `${index + 1}º`;

        let distanceText;
        if (!playerResult.hasGuessed) {
            distanceText = '— não jogou';
        } else if (playerResult.distanceKm < 1) {
            distanceText = `📍 ${Math.round(playerResult.distanceKm * 1000)} m`;
        } else {
            distanceText = `📍 ${playerResult.distanceKm.toFixed(1).replace('.', ',')} km`;
        }

        // Cor por proximidade: verde (perto) → amarelo → laranja → vermelho (longe)
        let proximityColor = 'var(--text-faint)';
        if (playerResult.hasGuessed) {
            if (playerResult.distanceKm < 25) proximityColor = 'var(--success)';
            else if (playerResult.distanceKm < 250) proximityColor = 'var(--warning)';
            else if (playerResult.distanceKm < 1000) proximityColor = 'var(--caution)';
            else proximityColor = 'var(--danger)';
        }

        const card = document.createElement('div');
        card.className = 'result-player-card' + (isYou ? ' is-you' : '');
        card.innerHTML = `
            <div class="result-rank">${rank}</div>
            <div class="result-player-info">
                <div class="result-player-name">${playerResult.name}${isYou ? ' <span class="you-tag">você</span>' : ''}</div>
                <div class="result-player-distance" style="color:${proximityColor}">${distanceText}</div>
            </div>
            <div class="result-points-section">
                <div class="result-points-value">0 pts</div>
                <div class="result-points-bar-track">
                    <div class="result-points-bar-fill" data-target="${playerResult.points}"></div>
                </div>
            </div>
        `;
        resultsDisplay.appendChild(card);

        // Animação escalonada: slide-in → barra → contador
        setTimeout(() => {
            card.classList.add('visible');
            setTimeout(() => {
                const barFill = card.querySelector('.result-points-bar-fill');
                const pointsEl = card.querySelector('.result-points-value');
                const target = playerResult.points;
                barFill.style.width = `${(target / 5000) * 100}%`;

                let current = 0;
                const steps = 25;
                const increment = target / steps;
                const stepTime = 600 / steps;
                const counter = setInterval(() => {
                    current = Math.min(current + increment, target);
                    pointsEl.textContent = `${Math.round(current)} pts`;
                    if (current >= target) clearInterval(counter);
                }, stepTime);
            }, 200);
        }, index * 180);
    });

    // --- Placar geral compacto ---
    const overallStandings = [...players].sort((a, b) => b.total_score - a.total_score);
    standingsDisplay.innerHTML = '<p class="result-section-title">Placar Geral</p>';
    overallStandings.forEach((player, index) => {
        const isYou = player.client_id === clientId;
        const row = document.createElement('div');
        row.className = 'standings-row' + (isYou ? ' is-you' : '');
        row.innerHTML = `
            <span>${medals[index] || `${index + 1}º`} ${player.name}</span>
            <span><b>${player.total_score.toLocaleString('pt-BR')} pts</b></span>
        `;
        standingsDisplay.appendChild(row);
    });
}

function renderGameOver(players) {
    localStorage.removeItem('lg_gameId');
    inGameUI.style.display = 'none';
    mapContainer.style.display = 'none';
    roundResultContainer.style.display = 'none';

    const medals = ['🥇', '🥈', '🥉'];
    const results = [...players].sort((a, b) => b.total_score - a.total_score);
    const winner = results[0];
    const isWinner = winner && winner.client_id === clientId;

    const box = document.createElement('div');
    box.className = 'menu-box gameover-box';

    const title = document.createElement('div');
    title.className = 'gameover-title';
    title.textContent = isWinner ? '🏆 Você Venceu!' : 'Fim de Jogo!';
    box.appendChild(title);

    const sectionLabel = document.createElement('p');
    sectionLabel.className = 'result-section-title';
    sectionLabel.style.marginTop = '18px';
    sectionLabel.textContent = 'Placar Final';
    box.appendChild(sectionLabel);

    results.forEach((player, index) => {
        const isYou = player.client_id === clientId;
        const card = document.createElement('div');
        card.className = 'gameover-card' + (isYou ? ' is-you' : '') + (index === 0 ? ' winner' : '');
        card.innerHTML = `
            <span class="gameover-rank">${medals[index] || `${index + 1}º`}</span>
            <span class="gameover-name">${player.name}${isYou ? ' <span class="you-tag">você</span>' : ''}</span>
            <span class="gameover-score">${player.total_score.toLocaleString('pt-BR')} pts</span>
        `;
        box.appendChild(card);

        card.style.opacity = '0';
        card.style.transform = 'translateY(12px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 150 + 100);
    });

    const btn = document.createElement('button');
    btn.textContent = 'Jogar Novamente';
    btn.style.marginTop = '24px';
    btn.onclick = () => { window.location.href = '/'; };
    box.appendChild(btn);

    menuContainer.style.display = 'flex';
    menuContainer.innerHTML = '';
    menuContainer.appendChild(box);
}

// Entra numa sala (dono ou convidado): garante que meu jogador existe, assina o
// Realtime e renderiza o estado atual.
async function enterGame(gameId) {
    currentGameId = gameId;
    try {
        const state = await apiRequest('POST', `/${gameId}/join`, { clientId });
        subscribeToGame(gameId);
        applyState(state);
    } catch (error) {
        alert(error.message);
        window.location.href = '/';
    }
}

// --- Função Principal de Inicialização ---
function initGame() {
    if (hasInitialized) return;
    hasInitialized = true;

    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 0, lng: 0 }, zoom: 1, streetViewControl: false, mapTypeControl: false,
    });

    map.addListener("click", (event) => {
        if (guessBtn.disabled) return;
        if (guessMarker) guessMarker.setMap(null);
        guessMarker = new google.maps.Marker({ position: event.latLng, map: map });
        guessedLocation = event.latLng;
    });

    // --- Lógica da Interface e Menus ---

    wireSetupScreen({ prefix: 'classic', gameMode: 'streetview', hasRestrictMovement: true });
    wireSetupScreen({ prefix: 'video', gameMode: 'video', hasRestrictMovement: false });

    // Botão "Voltar" no menu de entrada por código
    backFromJoinBtn.addEventListener('click', () => {
        window.location.href = '/';
    });

    // Confirmar entrada por código (botão e tecla Enter)
    const doJoinByCode = async () => {
        const code = joinCodeInput.value.trim().toUpperCase();
        if (!code || code.length < 4) return;
        joinErrorMsg.style.display = 'none';
        confirmJoinBtn.disabled = true;
        confirmJoinBtn.textContent = 'Entrando...';

        try {
            const newUrl = window.location.pathname + `?game=${code}`;
            history.pushState(null, '', newUrl);
            localStorage.setItem('lg_gameId', code);
            await enterGame(code);
            joinRoomMenu.style.display = 'none';
            confirmJoinBtn.disabled = false;
            confirmJoinBtn.textContent = 'Entrar';
        } catch (error) {
            joinErrorMsg.style.display = 'block';
            confirmJoinBtn.disabled = false;
            confirmJoinBtn.textContent = 'Entrar';
            history.pushState(null, '', window.location.pathname);
        }
    };

    confirmJoinBtn.addEventListener('click', doJoinByCode);
    joinCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doJoinByCode();
    });
    // Força uppercase enquanto digita
    joinCodeInput.addEventListener('input', () => {
        joinCodeInput.value = joinCodeInput.value.toUpperCase();
    });

    confirmNameBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value;
        if (!playerName || !playerName.trim()) {
            alert("Por favor, digite um nome válido!");
            return;
        }
        try {
            const state = await apiRequest('PATCH', `/${currentGameId}/player`, {
                clientId, name: playerName.trim().slice(0, 15)
            });
            applyState(state);
        } catch (error) {
            alert(error.message);
        }
    });

    startGameBtn.addEventListener('click', async () => {
        try {
            const state = await apiRequest('POST', `/${currentGameId}/start`, { clientId });
            applyState(state);
        } catch (error) {
            alert(error.message);
        }
    });

    guessBtn.addEventListener('click', async () => {
        if (!guessedLocation) return alert("Escolha um local no mapa!");
        guessBtn.disabled = true;
        resultText.style.display = 'block';
        resultText.innerHTML = "Palpite enviado! Aguardando outros jogadores...";
        try {
            const state = await apiRequest('POST', `/${currentGameId}/guess`, {
                clientId, guess: guessedLocation.toJSON()
            });
            applyState(state);
        } catch (error) {
            guessBtn.disabled = false;
            resultText.style.display = 'none';
            alert(error.message);
        }
    });

    nextRoundBtn.addEventListener('click', async () => {
        try {
            const state = await apiRequest('POST', `/${currentGameId}/next-round`, { clientId });
            applyState(state);
        } catch (error) {
            alert(error.message);
        }
    });

    const copyBtn = document.getElementById('copy-link-btn');
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            copyBtn.textContent = '✅';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
        });
    });

    // --- Roteamento de entrada: qual tela abrir de acordo com a URL ---
    // (a home é o único menu principal; ela já manda pra cá com o parâmetro certo)
    const entryParams = new URLSearchParams(window.location.search);
    const gameId = entryParams.get('game');
    const screen = entryParams.get('screen');

    if (gameId) {
        lobbyMenu.style.display = 'block';
        enterGame(gameId);
    } else if (screen === 'classic') {
        classicSetupMenu.style.display = 'block';
    } else if (screen === 'video') {
        videoSetupMenu.style.display = 'block';
    } else if (screen === 'join') {
        joinRoomMenu.style.display = 'block';
        joinCodeInput.focus();
    } else {
        // URL inesperada (sem game/screen válido) — volta pra home
        window.location.href = '/';
    }
}
