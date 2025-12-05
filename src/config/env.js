// src/config/env.js
require('dotenv').config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// 🔐 Pipefy OAuth
const PIPEFY_CLIENT_ID     = requiredEnv('PIPEFY_CLIENT_ID');
const PIPEFY_CLIENT_SECRET = requiredEnv('PIPEFY_CLIENT_SECRET');
const PIPEFY_TOKEN_URL     = process.env.PIPEFY_TOKEN_URL || 'https://app.pipefy.com/oauth/token';

// 🔗 Pipefy API endpoint
const PIPEFY_ENDPOINT = process.env.PIPEFY_ENDPOINT || 'https://api.pipefy.com/graphql';

// 📌 Configs de extração Pipefy
const PHASE_ATIVOS_ID  = requiredEnv('PHASE_ATIVOS_ID');
const PAGE_SIZE        = Number(process.env.PAGE_SIZE || '50');
const CARDS_JSON_FILE  = process.env.CARDS_JSON_FILE || 'cards_ativos_raw.json';

// Pipe/quadros do Pipefy
const PIPE_ID = requiredEnv('PIPE_ID');

const PHASE_INATIVOS_ID = process.env.PHASE_INATIVOS_ID || '';

// 🔗 Sinergy API configs
const SINERGY_ENDPOINT = requiredEnv('SINERGY_ENDPOINT');
const SINERGY_USER     = requiredEnv('SINERGY_USER');
const SINERGY_PASS     = requiredEnv('SINERGY_PASS');

// 🧠 Alias para SOAP actions
const SINERGY_SOAP_ACTION_BY_CPF =
  process.env.SINERGY_SOAP_ACTION_BY_CPF ||
  process.env.SOAP_ACTION ||
  'http://tempuri.org/getDadosFuncionariosPorCpf';

const SINERGY_SOAP_ACTION_ATIVOS =
  process.env.SINERGY_SOAP_ACTION_ATIVOS ||
  'http://tempuri.org/GetDadosFuncionariosAtivosCompleto';

const DEBUG = process.env.DEBUG === '1';

module.exports = {
  // 🔐 OAuth Pipefy
  PIPEFY_CLIENT_ID,
  PIPEFY_CLIENT_SECRET,
  PIPEFY_TOKEN_URL,

  // 🔗 Pipefy GraphQL
  PIPEFY_ENDPOINT,
  PHASE_ATIVOS_ID,
  PAGE_SIZE,
  CARDS_JSON_FILE,
  PHASE_INATIVOS_ID,
  PIPE_ID,

  // 🔗 Sinergy SOAP
  SINERGY_ENDPOINT,
  SINERGY_USER,
  SINERGY_PASS,
  SINERGY_SOAP_ACTION_BY_CPF,
  SINERGY_SOAP_ACTION_ATIVOS,

  DEBUG,
};