const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRoundScore, haversineDistanceKm } = require('./scoring');

test('distância abaixo de 25m dá pontuação máxima', () => {
    assert.equal(calculateRoundScore(0), 5000);
    assert.equal(calculateRoundScore(0.02), 5000);
});

test('pontuação decai com a distância', () => {
    const near = calculateRoundScore(50);
    const far = calculateRoundScore(2000);
    assert.ok(near > far);
    assert.ok(far >= 0);
});

test('nunca retorna pontuação negativa', () => {
    assert.equal(calculateRoundScore(1_000_000), 0);
});

test('respeita o mapFactor customizado', () => {
    const defaultFactor = calculateRoundScore(500);
    const smallerFactor = calculateRoundScore(500, 500);
    assert.ok(smallerFactor < defaultFactor);
});

test('haversineDistanceKm: mesmo ponto dá distância 0', () => {
    assert.equal(haversineDistanceKm({ lat: -23.5505, lng: -46.6333 }, { lat: -23.5505, lng: -46.6333 }), 0);
});

test('haversineDistanceKm: um quarto da circunferência da Terra no equador', () => {
    const distance = haversineDistanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 });
    assert.ok(Math.abs(distance - 10007.5) < 5); // ~1/4 de 2*pi*6371km
});

test('haversineDistanceKm: São Paulo até Rio de Janeiro (~357km)', () => {
    const distance = haversineDistanceKm({ lat: -23.5505, lng: -46.6333 }, { lat: -22.9068, lng: -43.1729 });
    assert.ok(Math.abs(distance - 357) < 5);
});
