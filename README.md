# LocationGuessr
LocationGuessr

Um jogo multiplayer de adivinhação de localização baseado no Google Street View, onde os jogadores são transportados para um local aleatório no mundo e devem adivinhar sua posição em um mapa.

Visão Geral do Projeto

LocationGuessr é uma aplicação web interativa que combina a exploração do Google Street View com a emoção de um jogo de adivinhação multiplayer. Os jogadores criam salas, convidam amigos e competem para ver quem consegue identificar a localização correta com a maior precisão, ganhando pontos com base na proximidade de seus palpites.

Funcionalidades Principais

•
Experiência Imersiva: Explore locais aleatórios do mundo através do Google Street View.

•
Multiplayer em Tempo Real: Crie salas e jogue com amigos, com atualizações de status e pontuações em tempo real via Socket.IO.

•
Sistema de Pontuação Dinâmico: Pontos são calculados com base na distância entre o palpite do jogador e a localização correta.

•
Configurações de Sala Personalizáveis: Defina o número de rodadas e o limite de tempo por rodada.

•
Interface Intuitiva: Menus claros para criação de sala, lobby e exibição de resultados.

3. Configurar Chaves da API do Google

O projeto utiliza a API do Google Maps Platform para o Street View e o mapa. É crucial configurar suas chaves de API de forma segura.

3.1. Obter Chaves da API do Google

1.
Acesse o Google Cloud Console.

2.
Crie um novo projeto ou selecione um existente.

3.
Ative as seguintes APIs:

•
Maps JavaScript API

•
Street View Static API (se planeja usar imagens estáticas do Street View)

•
Street View Metadata API (necessária para o servidor buscar locais válidos)

1.
Crie duas chaves de API separadas:

•
Uma para uso no servidor (ex: SERVER_GOOGLE_API_KEY)

•
Uma para uso no cliente (ex: CLIENT_GOOGLE_API_KEY)

3.2. Configurar o Arquivo .env

Na pasta backend, crie um arquivo chamado .env (se ele ainda não existir) e adicione suas chaves de API da seguinte forma:

Plain Text


SERVER_GOOGLE_API_KEY="SUA_CHAVE_DE_API_DO_SERVIDOR_AQUI"
CLIENT_GOOGLE_API_KEY="SUA_CHAVE_DE_API_DO_CLIENTE_AQUI"


Importante: Substitua os placeholders pelas suas chaves reais. Este arquivo .env NÃO DEVE ser enviado para o controle de versão. Certifique-se de que backend/.env esteja listado no seu arquivo .gitignore.

3.3. Configurar Restrições no Google Cloud Console

Para cada chave de API, configure as restrições de segurança:

•
SERVER_GOOGLE_API_KEY** (Chave do Servidor):**

•
Restrições de Aplicativo: Selecione "IP addresses (web servers, cron jobs, etc.)" e adicione os endereços IP do seu servidor de produção. Para desenvolvimento local, você pode não precisar de restrições de IP, mas é altamente recomendado para produção.

•
Restrições de API: Restrinja esta chave apenas à Street View Metadata API.



•
CLIENT_GOOGLE_API_KEY** (Chave do Cliente):**

•
Restrições de Aplicativo: Selecione "HTTP referrers (web sites)" e adicione os domínios onde seu aplicativo cliente será executado. Ex: http://localhost:3000/* para desenvolvimento e https://seusite.com/* para produção.

•
Restrições de API: Restrinja esta chave à Maps JavaScript API e, se aplicável, à Street View Static API.



