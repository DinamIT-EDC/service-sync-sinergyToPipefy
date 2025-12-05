// src/infra/pipefyAuth.js
const {
  PIPEFY_CLIENT_ID,
  PIPEFY_CLIENT_SECRET,
  PIPEFY_TOKEN_URL,
  DEBUG,
} = require('../config/env');

let cachedToken = null;

/**
 * Solicita um novo access_token ao Pipefy usando client_credentials
 * e armazena em cache em memória.
 */
async function requestNewAccessToken() {
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
    console.log('🔐 [PipefyAuth] Solicitando novo access_token ao Pipefy...');
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

  const expiresInSec = json.expires_in || 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;

  cachedToken = {
    accessToken: json.access_token,
    expiresAt,
  };

  if (DEBUG) {
    console.log(
      `✅ [PipefyAuth] Novo access_token obtido. expires_in: ${expiresInSec} segundos`
    );
  }

  return json.access_token;
}

/**
 * Retorna um access_token válido (usa cache em memória durante a execução).
 */
async function getPipefyAccessToken() {
  const marginMs = 60 * 1000; // margem de 1 min

  if (
    cachedToken &&
    cachedToken.expiresAt &&
    cachedToken.expiresAt - marginMs > Date.now()
  ) {
    return cachedToken.accessToken;
  }

  return await requestNewAccessToken();
}

module.exports = {
  getPipefyAccessToken,
};
