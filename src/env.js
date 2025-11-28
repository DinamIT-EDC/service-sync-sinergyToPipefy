// src/env.js
require('dotenv').config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const PIPEFY_TOKEN    = requiredEnv('PIPEFY_TOKEN');
const PIPEFY_ENDPOINT = process.env.PIPEFY_ENDPOINT || 'https://api.pipefy.com/graphql';

const PHASE_ATIVOS_ID  = requiredEnv('PHASE_ATIVOS_ID');
const PAGE_SIZE        = Number(process.env.PAGE_SIZE || '50');
const CARDS_JSON_FILE  = process.env.CARDS_JSON_FILE || 'cards_ativos_raw.json';

const PHASE_INATIVOS_ID = process.env.PHASE_INATIVOS_ID || '';

const SINERGY_ENDPOINT = requiredEnv('SINERGY_ENDPOINT');
const SINERGY_USER     = requiredEnv('SINERGY_USER');
const SINERGY_PASS     = requiredEnv('SINERGY_PASS');

// ⬇️ Aqui eu faço o "alias": uso SINERGY_SOAP_ACTION_BY_CPF OU SOAP_ACTION
const SINERGY_SOAP_ACTION_BY_CPF =
  process.env.SINERGY_SOAP_ACTION_BY_CPF ||
  process.env.SOAP_ACTION ||
  'http://tempuri.org/getDadosFuncionariosPorCpf';

// Para ativos completos (GetDadosFuncionariosAtivosCompleto)
const SINERGY_SOAP_ACTION_ATIVOS =
  process.env.SINERGY_SOAP_ACTION_ATIVOS ||
  'http://tempuri.org/GetDadosFuncionariosAtivosCompleto';

const DEBUG = process.env.DEBUG === '1';

module.exports = {
  PIPEFY_TOKEN,
  PIPEFY_ENDPOINT,
  PHASE_ATIVOS_ID,
  PAGE_SIZE,
  CARDS_JSON_FILE,
  PHASE_INATIVOS_ID,
  SINERGY_ENDPOINT,
  SINERGY_USER,
  SINERGY_PASS,
  SINERGY_SOAP_ACTION_BY_CPF,
  SINERGY_SOAP_ACTION_ATIVOS,
  DEBUG,
};
