// Sorteio de locais (Street View) e vídeos (Vídeo Guesser) por região.
// Extraído do server.js pra ser reaproveitado tanto pelo servidor Socket.IO
// atual quanto pelas novas rotas stateless (Supabase/Vercel).
const axios = require('axios');
const { videoMatchesRegion, parseIsoDurationToSeconds, detectIntroSkipSeconds } = require('./videoSearch');
const VIDEOS = require('./videos.json');

const GOOGLE_MAPS_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || null;

const REGIONS = {
    world:         { label: '🌍 Mundial',          lat: [-85, 85],   lng: [-180, 180] },
    brazil:        { label: '🇧🇷 Brasil',           lat: [-34, 5],    lng: [-74, -34]  },
    south_america: { label: '🌎 América do Sul',   lat: [-56, 13],   lng: [-81, -34]  },
    north_america: { label: '🗽 América do Norte', lat: [15, 72],    lng: [-168, -52] },
    europe:        { label: '🏰 Europa',            lat: [35, 71],    lng: [-25, 45]   },
    africa:        { label: '🌍 África',            lat: [-35, 37],   lng: [-18, 52]   },
    asia:          { label: '🏯 Ásia',              lat: [1, 77],     lng: [26, 180]   },
    oceania:       { label: '🦘 Oceania',           lat: [-47, -10],  lng: [110, 180]  },
};

async function getSingleLocation(region = 'world', maxAttempts = 100) {
    const bounds = REGIONS[region] || REGIONS.world;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const lat = Math.random() * (bounds.lat[1] - bounds.lat[0]) + bounds.lat[0];
            const lng = Math.random() * (bounds.lng[1] - bounds.lng[0]) + bounds.lng[0];
            const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=100000&source=outdoor&key=${GOOGLE_MAPS_SERVER_KEY}`;
            const response = await axios.get(url, { timeout: 5000 });
            if (response.data.status === 'OK') {
                return response.data.location;
            }
        } catch (error) {
            console.error(`[${region}] Tentativa ${attempt}/${maxAttempts} falhou: ${error.message}`);
        }
    }
    throw new Error(`Não foi possível encontrar um local na região "${region}" após ${maxAttempts} tentativas.`);
}

// --- Modo "Vídeo Guesser": vídeos do YouTube com localização conhecida ---
const YT_SEARCH_QUERY = 'walking tour 4k';
const YT_LOCATION_RADIUS = '50km';
const YT_MIN_DURATION_SECONDS = 120; // pelo menos 2 min, pra parecer um passeio de verdade
const DEFAULT_INTRO_SKIP_SECONDS = 45; // usado quando não dá pra detectar onde a intro termina
let youtubeQuotaExceeded = false; // algum HTTP 403 quotaExceeded corta as próximas buscas ao vivo do dia

// Sorteia um ponto na região (igual ao getSingleLocation) e busca, ao vivo, um vídeo
// geolocalizado do YouTube perto dali. Retorna null se não achar nada aproveitável —
// quem chama cai de volta pro pool fixo em videos.json.
async function searchLiveVideoLocation(region, maxAttempts = 3) {
    if (!YOUTUBE_API_KEY || youtubeQuotaExceeded) return null;
    const bounds = REGIONS[region] || REGIONS.world;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const lat = Math.random() * (bounds.lat[1] - bounds.lat[0]) + bounds.lat[0];
            const lng = Math.random() * (bounds.lng[1] - bounds.lng[0]) + bounds.lng[0];

            const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                timeout: 6000,
                params: {
                    part: 'snippet', type: 'video', maxResults: 5,
                    videoEmbeddable: 'true', safeSearch: 'strict', videoDuration: 'medium',
                    location: `${lat},${lng}`, locationRadius: YT_LOCATION_RADIUS,
                    q: YT_SEARCH_QUERY, key: YOUTUBE_API_KEY
                }
            });
            const ids = (searchRes.data.items || []).map(item => item.id && item.id.videoId).filter(Boolean);
            if (ids.length === 0) continue;

            const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                timeout: 6000,
                params: { part: 'snippet,recordingDetails,status,contentDetails', id: ids.join(','), key: YOUTUBE_API_KEY }
            });
            const candidate = (detailsRes.data.items || []).find(v =>
                v.status && v.status.embeddable &&
                v.recordingDetails && v.recordingDetails.location && v.recordingDetails.location.latitude != null &&
                parseIsoDurationToSeconds(v.contentDetails && v.contentDetails.duration) >= YT_MIN_DURATION_SECONDS
            );
            if (candidate) {
                return {
                    lat: candidate.recordingDetails.location.latitude,
                    lng: candidate.recordingDetails.location.longitude,
                    videoId: candidate.id,
                    startSeconds: detectIntroSkipSeconds(candidate.snippet && candidate.snippet.description, DEFAULT_INTRO_SKIP_SECONDS)
                };
            }
        } catch (error) {
            const reason = error.response?.data?.error?.errors?.[0]?.reason;
            if (reason === 'quotaExceeded') {
                youtubeQuotaExceeded = true;
                console.error('Cota da YouTube Data API esgotada — usando só o pool fixo pelo resto do dia.');
                return null;
            }
            console.error(`[youtube:${region}] tentativa ${attempt}/${maxAttempts} falhou: ${error.message}`);
        }
    }
    return null;
}

// Monta o conjunto de rounds do Vídeo Guesser: tenta buscar ao vivo (uma tentativa
// por round, em paralelo) e completa o que faltar sorteando do pool fixo, sem repetir vídeo.
async function getVideoRoundSet(region, numRounds) {
    const usedIds = new Set();
    const rounds = [];

    if (YOUTUBE_API_KEY) {
        const liveResults = await Promise.all(
            Array.from({ length: numRounds }, () => searchLiveVideoLocation(region))
        );
        for (const found of liveResults) {
            if (found && !usedIds.has(found.videoId)) {
                usedIds.add(found.videoId);
                rounds.push(found);
            }
        }
    }

    if (rounds.length < numRounds) {
        let pool = VIDEOS.filter(v => videoMatchesRegion(v, region) && !usedIds.has(v.id));
        if (pool.length === 0) pool = VIDEOS.filter(v => !usedIds.has(v.id));
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        for (const v of shuffled) {
            if (rounds.length >= numRounds) break;
            usedIds.add(v.id);
            rounds.push({
                lat: v.lat, lng: v.lng, videoId: v.id, videoTitle: v.title,
                startSeconds: v.startSeconds != null ? v.startSeconds : DEFAULT_INTRO_SKIP_SECONDS
            });
        }
    }

    return rounds;
}

module.exports = { REGIONS, getSingleLocation, getVideoRoundSet };
