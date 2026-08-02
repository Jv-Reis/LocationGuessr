const { test } = require('node:test');
const assert = require('node:assert/strict');
const { videoMatchesRegion, parseIsoDurationToSeconds, detectIntroSkipSeconds } = require('./videoSearch');

test('videoMatchesRegion: "world" aceita qualquer vídeo', () => {
    assert.equal(videoMatchesRegion({ region: 'asia' }, 'world'), true);
    assert.equal(videoMatchesRegion({ region: 'asia' }, ''), true);
});

test('videoMatchesRegion: região igual bate', () => {
    assert.equal(videoMatchesRegion({ region: 'europe' }, 'europe'), true);
    assert.equal(videoMatchesRegion({ region: 'europe' }, 'asia'), false);
});

test('videoMatchesRegion: "south_america" também aceita vídeos marcados como "brazil"', () => {
    assert.equal(videoMatchesRegion({ region: 'brazil' }, 'south_america'), true);
    assert.equal(videoMatchesRegion({ region: 'brazil' }, 'north_america'), false);
});

test('parseIsoDurationToSeconds: converte horas, minutos e segundos', () => {
    assert.equal(parseIsoDurationToSeconds('PT1H2M3S'), 3723);
    assert.equal(parseIsoDurationToSeconds('PT5M'), 300);
    assert.equal(parseIsoDurationToSeconds('PT45S'), 45);
});

test('parseIsoDurationToSeconds: entrada inválida ou ausente vira 0', () => {
    assert.equal(parseIsoDurationToSeconds(''), 0);
    assert.equal(parseIsoDurationToSeconds(undefined), 0);
    assert.equal(parseIsoDurationToSeconds('abc'), 0);
});

test('detectIntroSkipSeconds: sem descrição ou sem capítulos usa o padrão', () => {
    assert.equal(detectIntroSkipSeconds(undefined), 45);
    assert.equal(detectIntroSkipSeconds(''), 45);
    assert.equal(detectIntroSkipSeconds('Um vídeo qualquer sem timestamps.'), 45);
    assert.equal(detectIntroSkipSeconds('00:00 Único capítulo'), 45);
});

test('detectIntroSkipSeconds: pula pro 2º capítulo quando o 1º é intro/preview', () => {
    const desc = '00:00 Intro\n01:01 Sanam Chai Rd\n06:27 Thai Wang Rd';
    assert.equal(detectIntroSkipSeconds(desc), 61);
});

test('detectIntroSkipSeconds: aceita timestamps com horas (h:mm:ss)', () => {
    const desc = '0:00 Intro and Map\n1:07 Tour Begins\n3:46 The Rialto Bridge';
    assert.equal(detectIntroSkipSeconds(desc), 67);
});

test('detectIntroSkipSeconds: mantém 0 quando o 1º capítulo já é conteúdo real', () => {
    const desc = '00:00 Broadway\n02:00 West 57th Street';
    assert.equal(detectIntroSkipSeconds(desc), 0);
});

test('detectIntroSkipSeconds: usa o padrão customizado quando informado', () => {
    assert.equal(detectIntroSkipSeconds('sem timestamps', 30), 30);
});
