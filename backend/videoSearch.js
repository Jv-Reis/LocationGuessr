function videoMatchesRegion(video, region) {
    if (!region || region === 'world') return true;
    if (video.region === region) return true;
    if (region === 'south_america' && video.region === 'brazil') return true;
    return false;
}

function parseIsoDurationToSeconds(iso) {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    if (!match) return 0;
    const [, h, m, s] = match;
    return (parseInt(h || 0, 10) * 3600) + (parseInt(m || 0, 10) * 60) + parseInt(s || 0, 10);
}

const CHAPTER_LINE_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/;
const INTRO_LABEL_RE = /intro|preview|map|welcome|overview/i;

// Muitos vídeos de "walking tour" abrem com alguns segundos/minutos de intro ou
// recapitulação (às vezes com texto na tela) antes de começar a caminhada de
// verdade. Quando a descrição do vídeo tem capítulos marcados, usa isso pra
// escolher um ponto de início que já pule essa abertura.
function detectIntroSkipSeconds(description, defaultSeconds = 45) {
    if (!description) return defaultSeconds;

    const chapters = [];
    for (const rawLine of description.split(/\r?\n/)) {
        const match = CHAPTER_LINE_RE.exec(rawLine.trim());
        if (!match) continue;
        const [, h, m, s, label] = match;
        const seconds = (parseInt(h || 0, 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10);
        chapters.push({ seconds, label: label.trim() });
        if (chapters.length >= 2) break;
    }

    if (chapters.length < 2) return defaultSeconds;
    if (INTRO_LABEL_RE.test(chapters[0].label)) return chapters[1].seconds;
    return 0; // primeiro capítulo já é conteúdo real (ex.: nome de rua/praça)
}

module.exports = { videoMatchesRegion, parseIsoDurationToSeconds, detectIntroSkipSeconds };
