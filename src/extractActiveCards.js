// src/extractActiveCards.js
const fs = require('fs');
const {
  PIPEFY_TOKEN,
  PIPEFY_ENDPOINT,
  PHASE_ATIVOS_ID,
  PAGE_SIZE,
  CARDS_JSON_FILE,
  DEBUG,
} = require('./env');

async function fetchActiveCardsPage(afterCursor) {
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
      Authorization: `Bearer ${PIPEFY_TOKEN}`,
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
      console.error('Pipefy GraphQL errors:', JSON.stringify(json.errors, null, 2));
    }
    throw new Error('Pipefy GraphQL returned errors when fetching active cards');
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

async function extractActiveCards() {
  console.log('📥 Fetching ACTIVE cards from Pipefy...');

  let allCards = [];
  let afterCursor = null;
  let page = 0;

  while (true) {
    page += 1;
    console.log(`  ➜ Page ${page} (after: ${afterCursor || 'null'})`);

    const { cards, hasNextPage, endCursor } = await fetchActiveCardsPage(afterCursor);

    console.log(`     Found ${cards.length} cards on this page.`);
    allCards = allCards.concat(cards);

    if (!hasNextPage || !endCursor) break;
    afterCursor = endCursor;
  }

  console.log(`\n✅ Total ACTIVE cards fetched: ${allCards.length}`);

  fs.writeFileSync(CARDS_JSON_FILE, JSON.stringify(allCards, null, 2), 'utf8');
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
