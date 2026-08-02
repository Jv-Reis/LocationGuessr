-- Etapa 3 do plano de migração: guarda o resultado calculado de cada round
-- (distância/pontos por jogador) na própria linha de `games`, pra que o
-- Realtime entregue o mesmo resultado pra todo mundo — sem isso, só quem
-- disparasse o fim do round (o último a chutar, ou quem acionasse o timeout)
-- veria o cálculo; os outros só veriam o placar final mudar, sem saber por quê.
alter table games add column if not exists last_round_results jsonb;
