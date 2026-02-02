// src/infra/pipefyClient.js
const { PIPEFY_ENDPOINT, DEBUG } = require('../config/env');
const { getPipefyAccessToken } = require('./pipefyAuth');

/**
 * Chama o GraphQL do Pipefy com um token OAuth válido.
 */
async function callPipefy(query, variables = {}) {
  if (!PIPEFY_ENDPOINT) {
    throw new Error('PIPEFY_ENDPOINT não configurado no .env');
  }

  const accessToken = await getPipefyAccessToken();

  const res = await fetch(PIPEFY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('❌ [PipefyClient] Resposta não é JSON:');
    console.error(text.slice(0, 800));
    throw new Error('Resposta Pipefy inválida (não-JSON)');
  }

  if (!res.ok) {
    console.error(`❌ [PipefyClient] HTTP ${res.status}`);
    console.error(text.slice(0, 800));
    throw new Error(`Erro HTTP Pipefy ${res.status}`);
  }

  if (json.errors && json.errors.length > 0) {
    if (DEBUG) {
      console.error(
        '[PipefyClient] GraphQL errors:',
        JSON.stringify(json.errors, null, 2)
      );
    }
    throw new Error('Pipefy GraphQL retornou erros');
  }

  return json.data;
}

module.exports = {
  callPipefy,
};