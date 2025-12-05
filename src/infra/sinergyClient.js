// src/infra/sinergyClient.js
const { XMLParser } = require('fast-xml-parser');
const {
  SINERGY_ENDPOINT,
  SINERGY_USER,
  SINERGY_PASS,
  SINERGY_SOAP_ACTION_BY_CPF,
  SINERGY_SOAP_ACTION_ATIVOS,
  DEBUG,
} = require('../config/env');
const {
  escapeXml,
  onlyDigits,
  formatCpfMask,
} = require('../utils');

const parserOpts = {
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
};

function logDebug(...args) {
  if (DEBUG) console.log('[Sinergy]', ...args);
}

// ========== SOAP genérico ==========

async function callSoap(envelope, soapAction) {
  if (!SINERGY_ENDPOINT) {
    throw new Error('SINERGY_ENDPOINT não definido no .env');
  }

  const res = await fetch(SINERGY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: soapAction,
    },
    body: envelope,
  });

  const xml = await res.text();

  if (!res.ok) {
    console.error(`❌ [Sinergy] HTTP ${res.status} ${res.statusText}`);
    console.error(xml.slice(0, 800));
    throw new Error(`SOAP HTTP error ${res.status}`);
  }

  return xml;
}

// ========== POR CPF (getDadosFuncionariosPorCpf) ==========

function buildEnvelopeByCpf(usuario, senha, cpfComMascara) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <AuthSoapHd xmlns="http://tempuri.org/">
      <Usuario>${escapeXml(usuario)}</Usuario>
      <Senha>${escapeXml(senha)}</Senha>
    </AuthSoapHd>
  </soap:Header>
  <soap:Body>
    <getDadosFuncionariosPorCpf xmlns="http://tempuri.org/">
      <cpf>${escapeXml(cpfComMascara)}</cpf>
    </getDadosFuncionariosPorCpf>
  </soap:Body>
</soap:Envelope>`;
}

function parseFuncionarioFromSoap(soapXml, cpfSolicitadoDigits) {
  const parser = new XMLParser(parserOpts);
  const soapObj = parser.parse(soapXml);

  const body = soapObj?.Envelope?.Body;
  if (!body) throw new Error('SOAP Body missing.');

  if (body.Fault || body.fault) {
    console.error('❌ [Sinergy] SOAP Fault:', body.Fault || body.fault);
    throw new Error('SOAP Fault returned by service.');
  }

  const result =
    body?.getDadosFuncionariosPorCpfResponse?.getDadosFuncionariosPorCpfResult;

  if (!result || typeof result !== 'string') {
    logDebug(
      'getDadosFuncionariosPorCpfResult ausente ou não-string. Body:',
      body
    );
    return null;
  }

  const innerXml = result
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  const innerObj = parser.parse(innerXml);
  const raiz = innerObj.Funcionarios ?? innerObj.funcionarios ?? innerObj;
  let dados = raiz?.dadosFuncionario;

  if (!dados) return null;

  if (Array.isArray(dados)) {
    const filtrado = dados.find(
      (f) => onlyDigits(f.func_num_cpf) === cpfSolicitadoDigits
    );
    dados = filtrado || dados[0];
  }

  return dados || null;
}

async function getFuncionarioByCpf(cpfDigits) {
  if (!SINERGY_USER || !SINERGY_PASS) {
    throw new Error('SINERGY_USER ou SINERGY_PASS não definidos no .env');
  }

  const mascara = formatCpfMask(cpfDigits);
  const envelope = buildEnvelopeByCpf(SINERGY_USER, SINERGY_PASS, mascara);
  const soapXml = await callSoap(envelope, SINERGY_SOAP_ACTION_BY_CPF);
  const f = parseFuncionarioFromSoap(soapXml, cpfDigits);
  return f;
}

// ========== ATIVOS COMPLETOS (GetDadosFuncionariosAtivosCompleto) ==========

function buildEnvelopeAtivosCompleto(usuario, senha) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <AuthSoapHd xmlns="http://tempuri.org/">
      <Usuario>${escapeXml(usuario)}</Usuario>
      <Senha>${escapeXml(senha)}</Senha>
    </AuthSoapHd>
  </soap:Header>
  <soap:Body>
    <GetDadosFuncionariosAtivosCompleto xmlns="http://tempuri.org/" />
  </soap:Body>
</soap:Envelope>`;
}

function parseAtivosCompleto(soapXml) {
  const parser = new XMLParser(parserOpts);
  const soapObj = parser.parse(soapXml);

  const body = soapObj?.Envelope?.Body;
  if (!body) throw new Error('SOAP Body ausente.');

  if (body.Fault || body.fault) {
    console.error('❌ [Sinergy] SOAP Fault:', body.Fault || body.fault);
    throw new Error('SOAP Fault retornado pelo serviço.');
  }

  const result =
    body?.GetDadosFuncionariosAtivosCompletoResponse
      ?.GetDadosFuncionariosAtivosCompletoResult;

  if (!result || typeof result !== 'string') {
    logDebug(
      'GetDadosFuncionariosAtivosCompletoResult ausente ou não-string. Body:',
      body
    );
    return [];
  }

  const innerXml = result
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  const innerObj = parser.parse(innerXml);
  const raiz = innerObj.FuncAtivosCompleto ?? innerObj;

  let dados = raiz?.dadosFuncionarioAtivosCompleto;
  if (!dados) return [];

  if (!Array.isArray(dados)) {
    dados = [dados];
  }

  return dados;
}

async function fetchActiveEmployeesFromSinergy() {
  if (!SINERGY_USER || !SINERGY_PASS) {
    throw new Error('SINERGY_USER ou SINERGY_PASS não definidos no .env');
  }

  console.log('📡 [Sinergy] Fetching ATIVOS COMPLETOS...');

  const envelope = buildEnvelopeAtivosCompleto(SINERGY_USER, SINERGY_PASS);
  const soapXml = await callSoap(envelope, SINERGY_SOAP_ACTION_ATIVOS);
  const funcionarios = parseAtivosCompleto(soapXml);

  console.log(
    `✅ [Sinergy] Retornados ${funcionarios.length} funcionários ativos.`
  );

  if (funcionarios.length > 0) {
    const sample = funcionarios.slice(0, 2);
    console.log('🔎 [Sinergy] Sample (first 2):');
    for (const f of sample) {
      console.log(
        `  - ${f.func_nom} | CPF = ${f.func_num_cpf} | Matricula = ${f.func_num}`
      );
    }
  }

  return funcionarios;
}

module.exports = {
  getFuncionarioByCpf,
  fetchActiveEmployeesFromSinergy,
};
