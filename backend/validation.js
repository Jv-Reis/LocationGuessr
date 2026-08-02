const MIN_ROUNDS = 1;
const MAX_ROUNDS = 10;
const MIN_ROUND_TIME = 10;
const MAX_ROUND_TIME = 600;

function clampNumRounds(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 5;
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, n));
}

function clampRoundTimeLimit(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(MAX_ROUND_TIME, Math.max(MIN_ROUND_TIME, n));
}

function isValidGuess(guess) {
    return !!guess
        && typeof guess.lat === 'number' && Number.isFinite(guess.lat) && guess.lat >= -90 && guess.lat <= 90
        && typeof guess.lng === 'number' && Number.isFinite(guess.lng) && guess.lng >= -180 && guess.lng <= 180;
}

module.exports = {
    MIN_ROUNDS, MAX_ROUNDS, MIN_ROUND_TIME, MAX_ROUND_TIME,
    clampNumRounds, clampRoundTimeLimit, isValidGuess
};
