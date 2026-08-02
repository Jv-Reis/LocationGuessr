// Distância em km entre dois pontos {lat, lng} pela fórmula de Haversine.
function haversineDistanceKm(a, b) {
    const R = 6371; // raio médio da Terra em km
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function calculateRoundScore(distanceInKm, mapFactor = 2000) {
    if (distanceInKm * 1000 < 25) {
        return 5000;
    }
    const power = (-1 * distanceInKm) / mapFactor;
    const score = 5000 * Math.exp(power);
    if (score < 0) {
        return 0;
    }
    return Math.round(score);
}

module.exports = { calculateRoundScore, haversineDistanceKm };
