# LocationGuessr

Jogo multiplayer estilo GeoGuessr. Backend em Express (rotas stateless) + Supabase (Postgres + Realtime), frontend estático em HTML/CSS/JS puro com Google Maps / Street View.

## Rodando localmente

```bash
cd backend
npm install
cp .env.example .env   # preencha as chaves do Google Maps, YouTube (opcional) e Supabase
npm start
```

Acesse `http://localhost:3000`.

## Configurando o Supabase

O jogo não guarda nenhum estado de partida em memória — tudo fica no Supabase. Antes de rodar:

1. Crie um projeto em [supabase.com](https://supabase.com/).
2. No **SQL Editor**, rode nessa ordem: `supabase/schema.sql`, depois `supabase/migration_2_round_results.sql`.
3. Habilite Realtime e a política de leitura pública nas duas tabelas:
   ```sql
   alter publication supabase_realtime add table games;
   alter publication supabase_realtime add table players;

   alter table games enable row level security;
   alter table players enable row level security;

   create policy "Leitura pública de games" on games for select using (true);
   create policy "Leitura pública de players" on players for select using (true);
   ```
   (A escrita continua bloqueada pra chave pública — só a secret key do servidor grava, via `service_role`.)
4. Em **Project Settings > API**, copie a **Project URL**, a **publishable key** e a **secret key** pro `backend/.env`.

## Chaves do Google Maps

O projeto usa **duas chaves separadas** (veja `backend/.env.example`):

- `GOOGLE_MAPS_SERVER_KEY` — usada só pelo servidor para consultar a Street View Metadata API. Nunca é enviada ao navegador. Restrinja por IP no Google Cloud Console.
- `GOOGLE_MAPS_CLIENT_KEY` — enviada ao navegador para carregar a Maps JavaScript API. **Restrinja por HTTP referrer** (seu domínio) no Google Cloud Console, já que qualquer visitante consegue vê-la.

## Modo Vídeo Guesser

Por padrão, os vídeos vêm de um pool fixo (`backend/videos.json`) já verificado quanto a incorporação (embed).

Opcionalmente, defina `YOUTUBE_API_KEY` para busca **ao vivo**: o servidor sorteia um ponto dentro da região escolhida (mesma lógica do Street View) e busca no YouTube vídeos geolocalizados perto dali, usando os parâmetros `location`/`locationRadius` da YouTube Data API v3. Precisa:

1. Habilitar a "YouTube Data API v3" no Google Cloud Console e gerar uma chave.
2. Definir `YOUTUBE_API_KEY` em `backend/.env`.

**Atenção à cota**: `search.list` custa 100 unidades por chamada, e a cota grátis padrão é 10.000/dia — ou seja, algumas dezenas de rounds "ao vivo" por dia. Ao esgotar (ou se a chave não estiver definida), o servidor cai automaticamente para o pool fixo, sem quebrar o jogo.

## Arquitetura

- **`public/`** — frontend estático (sem build step). `index.html` é a landing/menu principal; `game.html` + `game.js` são a sala/lobby/partida.
- **`backend/server.js`** — rotas Express finas (`/api/rest/games/...`) que só validam a entrada e chamam `gameService.js`.
- **`backend/gameService.js`** — toda a lógica do jogo (criar sala, entrar, iniciar, chutar, pontuar, próximo round), lendo/escrevendo direto no Supabase. Sem estado em memória.
- **Tempo real** — o navegador assina o Supabase Realtime (`postgres_changes` nas tabelas `games`/`players`) direto com a chave pública, em vez de manter uma conexão de socket com o nosso servidor.
- **Timer do round** — não existe `setTimeout` no servidor. Cada cliente calcula a contagem a partir de `games.round_deadline`; ao chegar a 0, chama `/round-timeout`, que só tem efeito se o round ainda não tiver sido encerrado por outro caminho (trava otimista em `gameService.js`).

Como não há mais estado em memória nem conexões persistentes, isso roda tanto num processo Node comum (Railway, Render, um VPS, `npm start` local) quanto em funções serverless (Vercel).

**Limitação conhecida**: não há detecção de desconexão (Presence) ainda — se alguém sair sem avisar, continua listado na sala, e não existe troca automática de host. Fica pra uma próxima etapa.

## Deploy na Vercel

O repositório já está pronto pro deploy (`api/index.js` reexporta o app Express, `vercel.json` roteia tudo pra ele, `package.json` na raiz espelha as dependências do `backend/` pro build da Vercel instalar). Falta só a parte que exige a sua conta:

1. Suba o repositório pro GitHub (se ainda não estiver lá).
2. Em [vercel.com](https://vercel.com/), **Add New... > Project** e importe o repositório.
3. Nas configurações do projeto (**Settings > Environment Variables**), adicione as 6 variáveis do `backend/.env`: `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_CLIENT_KEY`, `YOUTUBE_API_KEY` (opcional), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. A Vercel injeta isso direto no `process.env` — não lê o arquivo `.env` (que nem vai pro repositório).
4. Deploy. A Vercel detecta o `package.json` na raiz e o `vercel.json` sozinha, não precisa mexer em "Build Command" nem "Output Directory".

**Atenção**: `getSingleLocation` (sorteio de local no modo Clássico) tenta até 100 vezes com timeout de 5s cada se a Street View não achar nada na região — na prática resolve em 1-2 tentativas, mas num caso raro de muita sorte ruim pode passar do limite de execução de uma função serverless no plano gratuito (10s). Se isso virar problema de verdade, dá pra baixar o número de tentativas ou o timeout por tentativa.

## Testes

```bash
cd backend
npm test
```
