// src/extractActiveCards.js
const fs = require('fs');
const {
  PIPEFY_ENDPOINT,
  PHASE_ATIVOS_ID,
  PAGE_SIZE,
  CARDS_JSON_FILE,
  DEBUG,
  PIPEFY_CLIENT_ID,
  PIPEFY_CLIENT_SECRET,
  PIPEFY_TOKEN_URL,
} = require('./env');

/**
 * Busca um novo access_token OAuth no Pipefy usando client_credentials.
 * Essa função é chamada uma vez por execução do script.
 */
async function getPipefyAccessToken() {
  const tokenUrl = PIPEFY_TOKEN_URL || 'https://app.pipefy.com/oauth/token';

  if (!PIPEFY_CLIENT_ID || !PIPEFY_CLIENT_SECRET) {
    throw new Error(
      'PIPEFY_CLIENT_ID ou PIPEFY_CLIENT_SECRET não configurados no .env'
    );
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', PIPEFY_CLIENT_ID);
  params.append('client_secret', PIPEFY_CLIENT_SECRET);

  if (DEBUG) {
    console.log('🔐 Solicitando novo access_token ao Pipefy...');
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Erro ao obter token OAuth do Pipefy (${res.status}): ${text}`
    );
  }

  const json = await res.json();

  if (!json.access_token) {
    throw new Error(
      `Resposta OAuth do Pipefy não contém access_token: ${JSON.stringify(
        json
      )}`
    );
  }

  if (DEBUG) {
    console.log(
      `✅ Novo access_token obtido. expires_in: ${json.expires_in} segundos`
    );
  }

  return json.access_token;
}

/**
 * Busca uma página de cards ativos na fase configurada.
 * Agora recebe o accessToken como parâmetro.
 */
async function fetchActiveCardsPage(afterCursor, accessToken) {
  const query = `
    query GetActiveCards($phaseId: ID!, $pageSize: Int!, $after: String) {
      phase(id: $phaseId) {
        id
        name
        cards(first: $pageSize, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              created_at
              assignees {
                id
                name
                email
              }
              fields {
                name
                value
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    phaseId: PHASE_ATIVOS_ID,
    pageSize: PAGE_SIZE,
    after: afterCursor || null,
  };

  const res = await fetch(PIPEFY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`, // 🔑 token OAuth da execução
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipefy HTTP error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    if (DEBUG) {
      console.error(
        'Pipefy GraphQL errors:',
        JSON.stringify(json.errors, null, 2)
      );
    }
    throw new Error(
      'Pipefy GraphQL returned errors when fetching active cards'
    );
  }

  const phase = json.data?.phase;
  if (!phase) {
    throw new Error('Phase not found in Pipefy response');
  }

  const cardsConnection = phase.cards;
  const edges = cardsConnection?.edges || [];
  const pageInfo = cardsConnection?.pageInfo || {};

  const cards = edges.map((e) => e.node);

  return {
    cards,
    hasNextPage: !!pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor || null,
  };
}

/**
 * Fluxo principal: obtém o token OAuth, pagina sobre os cards ativos
 * e salva tudo em arquivo JSON.
 */
async function extractActiveCards() {
  console.log('📥 Fetching ACTIVE cards from Pipefy...');

  // 🔐 1) Busca um token novo para esta execução
  const accessToken = await getPipefyAccessToken();

  let allCards = [];
  let afterCursor = null;
  let page = 0;

  while (true) {
    page += 1;
    console.log(`  ➜ Page ${page} (after: ${afterCursor || 'null'})`);

    const { cards, hasNextPage, endCursor } =
      await fetchActiveCardsPage(afterCursor, accessToken);

    console.log(`     Found ${cards.length} cards on this page.`);
    allCards = allCards.concat(cards);

    if (!hasNextPage || !endCursor) break;
    afterCursor = endCursor;
  }

  console.log(`\n✅ Total ACTIVE cards fetched: ${allCards.length}`);

  fs.writeFileSync(
    CARDS_JSON_FILE,
    JSON.stringify(allCards, null, 2),
    'utf8'
  );
  console.log(`💾 Saved to ${CARDS_JSON_FILE}\n`);
}

// Permite usar como módulo (runDailySync) ou rodar direto: node src/extractActiveCards.js
if (require.main === module) {
  extractActiveCards().catch((err) => {
    console.error('Fatal error in extractActiveCards:', err.message);
    process.exit(1);
  });
}

module.exports = { extractActiveCards };