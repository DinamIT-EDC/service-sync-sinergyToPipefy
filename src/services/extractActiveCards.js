// src/services/extractActiveCards.js
const fs = require('fs');
const {
  PHASE_ATIVOS_ID,
  PAGE_SIZE,
  CARDS_JSON_FILE,
} = require('../config/env');
const { callPipefy } = require('../infra/pipefyClient');

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

  const data = await callPipefy(query, variables);

  const phase = data?.phase;
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

    const { cards, hasNextPage, endCursor } = await fetchActiveCardsPage(
      afterCursor
    );

    console.log(`     Found ${cards.length} cards on this page.`);
    allCards = allCards.concat(cards);

    if (!hasNextPage || !endCursor) break;
    afterCursor = endCursor;
  }

  console.log(`\n✅ Total ACTIVE cards fetched: ${allCards.length}`);

  fs.writeFileSync(CARDS_JSON_FILE, JSON.stringify(allCards, null, 2), 'utf8');
  console.log(`💾 Saved to ${CARDS_JSON_FILE}\n`);
}

// Permite rodar direto: node src/services/extractActiveCards.js
if (require.main === module) {
  extractActiveCards().catch((err) => {
    console.error('Fatal error in extractActiveCards:', err.message);
    process.exit(1);
  });
}

module.exports = { extractActiveCards };