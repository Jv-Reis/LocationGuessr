// --- Elementos da UI ---
const menuContainer = document.getElementById("menu-container");
const lobbyMenu = document.getElementById("lobby-menu");
const inGameUI = document.getElementById("in-game-ui");
const createGameBtn = document.getElementById("create-game-btn");
const roundsInput = document.getElementById("rounds-input");
const gameLinkInput = document.getElementById("game-link-input");
const lobbyPlayersList = document.getElementById("lobby-players");
const startGameBtn = document.getElementById("start-game-btn");
const panoElement = document.getElementById("pano");
const mapContainer = document.getElementById("map-container");
const guessBtn = document.getElementById("guess-btn");
const nextRoundBtn = document.getElementById("next-round-btn");
const roundDisplay = document.getElementById("round-display");
const resultText = document.getElementById("result-text");
const playerNameInput = document.getElementById("player-name-input");
const confirmNameBtn = document.getElementById("confirm-name-btn");
const namePrompt = document.getElementById("name-prompt");
const playerListSection = document.getElementById("player-list-section");
const roundResultContainer = document.getElementById("round-result-container");
const gameStatusHUD = document.getElementById("game-status-hud");
const mainMenuWrapper = document.querySelector(".main-menu-wrapper");
const mainMenu = document.getElementById("main-menu");
const timeInput = document.getElementById("time-input");
const timerDisplay = document.getElementById("timer-display");
const backToMainMenuBtn = document.getElementById("back-to-main-menu-btn");

// --- NOVAS REFERÊNCIAS ---
const roomSetupMenu = document.getElementById("room-setup-menu");
const createRoomBtn = document.getElementById("create-room-btn");


// --- Variáveis de estado do Jogo ---
const socket = io();
let hasInitialized = false;
let map, isHost = false, guessedLocation = null;
let guessMarker, correctMarker, playerMarkers = [], lines = [];
let roundTimerInterval = null;
let timeLeft = 0;

// --- Funções do Timer ---
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
    timerDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function handleTimeUp() {
    stopTimer();
    guessBtn.disabled = true;
    resultText.style.display = "block";
    resultText.innerHTML = "Tempo esgotado! Aguardando o resultado...";
}

// --- Função para carregar a API do Google Maps dinamicamente ---
async function loadGoogleMapsApi() {
    try {
        const response = await fetch("/api/client-key");
        const data = await response.json();
        const apiKey = data.apiKey;

        if (!apiKey) {
            console.error("API Key do cliente não encontrada.");
            alert("Erro ao carregar o jogo: Chave da API do Google não disponível.");
            return;
        }

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initGame`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    } catch (error) {
        console.error("Erro ao buscar a API Key do cliente:", error);
        alert("Erro ao carregar o jogo: Não foi possível obter a chave da API.");
    }
}

// Chame esta função quando o DOM estiver carregado
document.addEventListener("DOMContentLoaded", loadGoogleMapsApi);

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

    // Botão "Criar Sala" no menu principal
    createRoomBtn.addEventListener("click", () => {
        mainMenuWrapper.style.display = "none";
        roomSetupMenu.style.display = "block";
    });
    
    // Botão "Voltar" no menu de setup
    backToMainMenuBtn.addEventListener("click", () => {
        roomSetupMenu.style.display = "none";
        mainMenuWrapper.style.display = "flex";
    });
    
    // Lógica para os botões de setup
    const roundsDecrementBtn = document.getElementById("rounds-decrement");
    const roundsIncrementBtn = document.getElementById("rounds-increment");
    const timeDecrementBtn = document.getElementById("time-decrement");
    const timeIncrementBtn = document.getElementById("time-increment");
    const timeToggleCheckbox = document.getElementById("time-toggle-checkbox");
    const timeSelectorContainer = document.getElementById("time-selector-container");
    
    roundsDecrementBtn.addEventListener("click", () => { roundsInput.stepDown(); });
    roundsIncrementBtn.addEventListener("click", () => { roundsInput.stepUp(); });
    timeDecrementBtn.addEventListener("click", () => { timeInput.stepDown(); });
    timeIncrementBtn.addEventListener("click", () => { timeInput.stepUp(); });
    
    timeToggleCheckbox.addEventListener("change", () => {
        timeSelectorContainer.style.display = timeToggleCheckbox.checked ? "none" : "flex";
    });


    // Verifica se o jogador está entrando em um jogo existente via link
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get("game");

    if (gameId) {
        mainMenuWrapper.style.display = "none";
        roomSetupMenu.style.display = "none"; // Esconde menu de setup se entra por link
        lobbyMenu.style.display = "block";
        socket.emit("joinGame", { gameId: gameId });
    }
    
    // --- Listeners de Botões Principais ---
    createGameBtn.addEventListener("click", () => {
        createGameBtn.disabled = true;
        createGameBtn.textContent = "Criando...";
        const numRounds = parseInt(roundsInput.value, 10);
        const roundTimeLimit = timeToggleCheckbox.checked ? 0 : parseInt(timeInput.value, 10);
        
        // Aqui não precisa ler o modo de jogo ainda, pois só existe um
        socket.emit("createGame", { numRounds: numRounds, roundTimeLimit: roundTimeLimit });
    });

    confirmNameBtn.addEventListener("click", () => {
        const playerName = playerNameInput.value;
        if (playerName && playerName.trim()) {
            const gameId = new URLSearchParams(window.location.search).get("game");
            socket.emit("setPlayerName", { gameId: gameId, playerName: playerName });
            namePrompt.style.display = "none";
            playerListSection.style.display = "block";
        } else {
            alert("Por favor, digite um nome válido!");
        }
    });

    startGameBtn.addEventListener("click", () => {
        const gameId = new URLSearchParams(window.location.search).get("game");
        socket.emit("startGame", { gameId: gameId });
    });

    guessBtn.addEventListener("click", () => {
        if (!guessedLocation) return alert("Escolha um local no mapa!");
        const gameId = new URLSearchParams(window.location.search).get("game");
        socket.emit("submitGuess", { gameId: gameId, guess: guessedLocation.toJSON() });
        guessBtn.disabled = true;
        resultText.style.display = "block";
        resultText.innerHTML = "Palpite enviado! Aguardando outros jogadores...";
    });

    nextRoundBtn.addEventListener("click", () => {
        const gameId = new URLSearchParams(window.location.search).get("game");
        socket.emit("requestNextRound", { gameId: gameId });
    });
}


// --- Funções que OUVEM o Servidor (Socket.IO) ---
socket.on("gameCreated", (data) => {
    isHost = true;
    const { gameId } = data;
    const newUrl = window.location.pathname + `?game=${gameId}`;
    history.pushState(null, "", newUrl);
    roomSetupMenu.style.display = "none"; // Esconde o menu de setup
    lobbyMenu.style.display = "block";
    gameLinkInput.value = window.location.href;
    socket.emit("joinGame", { gameId: gameId });
});

socket.on("updatePlayerList", (data) => {
    lobbyPlayersList.innerHTML = "";
    data.players.forEach(player => {
        const li = document.createElement("li");
        if (player.id === socket.id && isHost) {
            startGameBtn.style.display = "block";
        }
        li.textContent = player.name + (player.id === socket.id ? " (Você)" : "");
        lobbyPlayersList.appendChild(li);
    });
});

socket.on("newRound", (data) => {
    menuContainer.style.display = "none";
    inGameUI.style.display = "block";
    mapContainer.style.display = "block";
    gameStatusHUD.style.display = "block";
    roundResultContainer.style.display = "none";
    guessBtn.style.display = "block";
    guessBtn.disabled = false;
    nextRoundBtn.style.display = "none";
    resultText.style.display = "none";
    guessedLocation = null;

    if (guessMarker) guessMarker.setMap(null);
    if (correctMarker) correctMarker.setMap(null);
    playerMarkers.forEach(m => m.setMap(null));
    lines.forEach(l => l.setMap(null));
    playerMarkers = [];
    lines = [];

    if (data.roundTimeLimit && data.roundTimeLimit > 0) {
        startTimer(data.roundTimeLimit);
    } else {
        stopTimer();
        timerDisplay.textContent = "∞";
    }

    roundDisplay.textContent = `Round ${data.round} / ${data.maxRounds}`;
    document.getElementById("round-results-display").innerHTML = "";
    document.getElementById("overall-standings-display").innerHTML = "";
    panoElement.innerHTML = "";

    new google.maps.StreetViewPanorama(panoElement, {
        position: data.location, addressControl: false, showRoadLabels: false,
        zoomControl: true, linksControl: true, pov: { heading: 270, pitch: 0 },
    });
});

socket.on("roundResult", (data) => {
    stopTimer();
    guessBtn.style.display = "none";
    resultText.style.display = "none";
    gameStatusHUD.style.display = "none";
    roundResultContainer.style.display = "flex";
    nextRoundBtn.style.display = "block";

    playerMarkers.forEach(m => m.setMap(null));
    lines.forEach(l => l.setMap(null));
    playerMarkers = [];
    lines = [];

    correctMarker = new google.maps.Marker({
        position: data.correctLocation, 
        map: map, 
        icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png"
    });

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(data.correctLocation);

    let roundResultsHTML = "<h4>Resultado do Round:</h4><ol style=\'padding-left: 20px;\'>";
    data.roundResults.forEach(playerResult => {
        const distanceText = isFinite(playerResult.distance) 
            ? `(${playerResult.distance.toFixed(2)} km)` 
            : "(Não jogou)";
        roundResultsHTML += `<li>${playerResult.name}: <b>${playerResult.points} pts</b> ${distanceText}</li>`;
        
        if (playerResult.hasGuessed && playerResult.guess) {
            const playerGuessMarker = new google.maps.Marker({
                position: playerResult.guess, 
                map: map, 
                label: playerResult.name.substring(0, 3)
            });
            playerMarkers.push(playerGuessMarker);

            const line = new google.maps.Polyline({
                path: [playerResult.guess, data.correctLocation], 
                map: map,
                strokeColor: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
            });
            lines.push(line);
            bounds.extend(playerResult.guess);
        }
    });
    roundResultsHTML += "</ol>";

    let overallStandingsHTML = "<h4>Placar Geral:</h4><ol style=\'padding-left: 20px;\'>";
    data.overallStandings.forEach(playerResult => {
        overallStandingsHTML += `<li>${playerResult.name}: <b>${playerResult.totalScore}</b> pontos</li>`;
    });
    overallStandingsHTML += "</ol>";

    map.fitBounds(bounds);
    document.getElementById("round-results-display").innerHTML = roundResultsHTML;
    document.getElementById("overall-standings-display").innerHTML = overallStandingsHTML;
});

// A função gameOver está simplificada aqui para não introduzir a complexidade do replay ainda
socket.on("gameOver", (data) => {
    inGameUI.style.display = "none";
    mapContainer.style.display = "none";
    roundResultContainer.style.display = "none";

    let finalResultsHTML = "<h1>Fim de Jogo!</h1><h2>Placar Final:</h2><ol style=\"padding-left: 20px; text-align: left;\">";
    data.results.forEach((player, index) => {
        finalResultsHTML += `<li><b>${index + 1}º: ${player.name}</b> - ${player.totalScore} pontos</li>`;
    });
    finalResultsHTML += "</ol><button onclick=\"window.location.href=window.location.pathname\">Jogar Novamente</button>";
    
    menuContainer.style.display = "flex";
    menuContainer.innerHTML = `<div class=\"menu-box\">${finalResultsHTML}</div>`;
});

socket.on("error", (data) => {
    alert(data.message);
    window.location.href = window.location.pathname;
});
