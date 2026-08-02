-- Etapa 1 do plano de migração pra Vercel + Supabase.
-- Rode isso no SQL Editor do seu projeto Supabase (Supabase Dashboard > SQL Editor > New query).

create table if not exists games (
    id text primary key,                        -- o código da sala (ex: "AB12CD")
    host_client_id text not null,
    game_state text not null default 'LOBBY',    -- LOBBY | IN_ROUND | ROUND_OVER
    current_round integer not null default 0,
    region text not null default 'world',
    region_label text not null default '',
    game_mode text not null default 'streetview',-- streetview | video
    restrict_movement boolean not null default false,
    round_time_limit integer not null default 0, -- 0 = tempo infinito
    round_deadline timestamptz,                  -- quando o round atual acaba (null = sem limite)
    locations jsonb not null default '[]',        -- array dos rounds sorteados (lat/lng/videoId/...)
    created_at timestamptz not null default now()
);

create table if not exists players (
    id uuid primary key default gen_random_uuid(),
    game_id text not null references games(id) on delete cascade,
    client_id text not null,                     -- o mesmo lg_clientId salvo no localStorage do navegador
    name text not null default 'Jogador',
    total_score integer not null default 0,
    current_guess jsonb,                          -- {lat, lng} ou null
    is_host boolean not null default false,
    connected_at timestamptz not null default now(),
    unique (game_id, client_id)
);

-- Índice pra achar rápido os jogadores de uma sala
create index if not exists players_game_id_idx on players(game_id);

-- Limpeza: apaga salas com mais de 24h (rode manualmente por enquanto; na Etapa 3
-- viramos isso um Cron job do Vercel ou pg_cron do Supabase)
-- delete from games where created_at < now() - interval '24 hours';
