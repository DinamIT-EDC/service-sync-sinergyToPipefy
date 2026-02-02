// src/infra/sinergyClient.js
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

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

function looksLikeHtml(str) {
  const s = (str || '').trim().toLowerCase();
  return s.startsWith('<!doctype html') || s.startsWith('<html');
}

function looksLikeBase64(str) {
  const s = (str || '').trim();
  // heurística simples: só caracteres base64 + tamanho razoável
  if (!s || s.length < 40) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(s);
}

function decodeInnerXml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function saveDebugPayload(filename, content) {
  if (!DEBUG) return;
  try {
    const outDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
    logDebug(`Payload salvo em debug/${filename}`);
  } catch (e) {
    logDebug('Falha ao salvar payload de debug:', e.message);
  }
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
      Accept: 'text/xml, application/xml, */*',
      'User-Agent': 'service-sync-sinergyToPipefy/1.0',
    },
    body: envelope,
  });

  const xml = await res.text();

  // Diagnóstico mesmo em 200 (quando DEBUG)
  logDebug('HTTP', res.status, res.statusText);
  logDebug('Content-Type', res.headers.get('content-type'));
  logDebug('Body length', xml.length);
  logDebug('Body head', xml.slice(0, 300));

  if (!res.ok) {
    console.error(`❌ [Sinergy] HTTP ${res.status} ${res.statusText}`);
    console.error(xml.slice(0, 800));
    throw new Error(`SOAP HTTP error ${res.status}`);
  }

  // Se começou a voltar HTML (bloqueio / WAF / página)
  if (looksLikeHtml(xml)) {
    saveDebugPayload('sinergy_html_response.html', xml);
    throw new Error(
      'Sinergy retornou HTML (possível bloqueio/WAF/proxy). Verifique status, IP de origem e regras do provedor.'
    );
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
    // Antes retornava null silencioso; agora sobe erro (pra não mascarar)
    saveDebugPayload('sinergy_bycpf_body.json', JSON.stringify(body, null, 2));
    throw new Error(
      'getDadosFuncionariosPorCpfResult ausente/não-string. Possível mudança de retorno, SOAPAction ou bloqueio.'
    );
  }

  if (result.toLowerCase().includes('login necessário')) {
    throw new Error(`Sinergy retornou: "${result}" (auth/header rejeitado)`);
  }

  const innerXml = decodeInnerXml(result);

  if (!innerXml.trim().startsWith('<')) {
    // Pode ser criptografado/base64
    saveDebugPayload('sinergy_bycpf_result.txt', result);
    throw new Error(
      'Result não parece XML após decode. Pode estar criptografado/base64 conforme configuração do Sinergy.'
    );
  }

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

  // ⚠️ Aqui é onde hoje você devolve [] e “some” com o erro.
  if (!result || typeof result !== 'string') {
    saveDebugPayload('sinergy_ativos_body.json', JSON.stringify(body, null, 2));
    throw new Error(
      'GetDadosFuncionariosAtivosCompletoResult ausente/não-string. Possível mudança de retorno, SOAPAction, ou bloqueio.'
    );
  }

  if (result.toLowerCase().includes('login necessário')) {
    throw new Error(`Sinergy retornou: "${result}" (auth/header rejeitado)`);
  }

  // Se vier base64/criptografado (ou gzip-base64) em vez de XML escapado:
  const trimmed = result.trim();
  if (!trimmed.includes('&lt;') && !trimmed.startsWith('<') && looksLikeBase64(trimmed)) {
    saveDebugPayload('sinergy_ativos_result_base64.txt', trimmed.slice(0, 5000));
    throw new Error(
      'Result parece base64 (possível retorno criptografado/compactado). Precisaremos tratar esse caso.'
    );
  }

  const innerXml = trimmed.startsWith('<') ? trimmed : decodeInnerXml(trimmed);

  if (!innerXml.trim().startsWith('<')) {
    saveDebugPayload('sinergy_ativos_result.txt', trimmed.slice(0, 8000));
    throw new Error(
      'Result não parece XML após decode. Pode estar criptografado/serializado.'
    );
  }

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

  console.log(`✅ [Sinergy] Retornados ${funcionarios.length} funcionários ativos.`);

  if (DEBUG && funcionarios.length > 0) {
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
