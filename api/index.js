// Ponto de entrada da função serverless da Vercel — reexporta o app Express
// como está. Todas as rotas (estáticas, /api/config, /api/rest/games/*) já
// vivem dentro dele, então não tem lógica nenhuma pra duplicar aqui.
module.exports = require('../backend/server.js');
