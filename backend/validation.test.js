const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampNumRounds, clampRoundTimeLimit, isValidGuess } = require('./validation');

test('clampNumRounds mantém valores válidos', () => {
    assert.equal(clampNumRounds(5), 5);
});

test('clampNumRounds limita valores fora do intervalo', () => {
    assert.equal(clampNumRounds(999), 10);
    assert.equal(clampNumRounds(-3), 1);
    assert.equal(clampNumRounds('abc'), 5);
});

test('clampRoundTimeLimit trata 0 como tempo infinito', () => {
    assert.equal(clampRoundTimeLimit(0), 0);
    assert.equal(clampRoundTimeLimit(-1), 0);
});

test('clampRoundTimeLimit limita valores extremos', () => {
    assert.equal(clampRoundTimeLimit(5), 10);
    assert.equal(clampRoundTimeLimit(99999), 600);
});

test('isValidGuess aceita coordenadas válidas', () => {
    assert.equal(isValidGuess({ lat: -23.5, lng: -46.6 }), true);
});

test('isValidGuess rejeita valores inválidos', () => {
    assert.equal(isValidGuess(null), false);
    assert.equal(isValidGuess({ lat: 200, lng: 0 }), false);
    assert.equal(isValidGuess({ lat: 'a', lng: 0 }), false);
    assert.equal(isValidGuess({ lat: 0 }), false);
});
