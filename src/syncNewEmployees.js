// src/syncNewEmployees.js
require('dotenv').config();
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

// ================== ENV / CONFIG ==================

const {
  PIPEFY_TOKEN,
  PIPEFY_ENDPOINT,
  PIPE_ID,
  CARDS_JSON_FILE,
  SINERGY_ENDPOINT,
  SINERGY_USER,
  SINERGY_PASS,
  DEBUG,
} = process.env;

const DEBUG_BOOL = String(DEBUG) === '1' || String(DEBUG).toLowerCase() === 'true';

// defaults
const PIPEFY_URL = PIPEFY_ENDPOINT || 'https://api.pipefy.com/graphql';
const CARDS_FILE = CARDS_JSON_FILE || 'cards_ativos_raw.json';

// SOAPAction específico para GetDadosFuncionariosAtivosCompleto
const SOAP_ACTION_ATIVOS = 'http://tempuri.org/GetDadosFuncionariosAtivosCompleto';

// ================== HELPERS LOCAIS ==================

function logDebug(...args) {
  if (DEBUG_BOOL) console.log('[DEBUG]', ...args);
}

function onlyDigits(s) {
  return (s || '').replace(/\D+/g, '');
}

function toIsoDateOrOriginal(str) {
  if (!str) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim());
  if (!m) return str;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function gqlEscape(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function escapeXml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ================== SINERGY – ATIVOS COMPLETOS ==================

const parserOpts = {
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
};

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

async function callSoapAtivosCompleto(envelope) {
  if (!SINERGY_ENDPOINT) {
    throw new Error('SINERGY_ENDPOINT não definido no .env');
  }

  const res = await fetch(SINERGY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: SOAP_ACTION_ATIVOS,
    },
    body: envelope,
  });

  const xml = await res.text();

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status} ${res.statusText}`);
    console.error(xml.slice(0, 800));
    throw new Error(`Falha SOAP HTTP ${res.status}`);
  }

  return xml;
}

function parseAtivosCompleto(soapXml) {
  const parser = new XMLParser(parserOpts);
  const soapObj = parser.parse(soapXml);

  const body = soapObj?.Envelope?.Body;
  if (!body) throw new Error('SOAP Body ausente.');

  if (body.Fault || body.fault) {
    console.error('❌ SOAP Fault:', body.Fault || body.fault);
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

  console.log('� Fetching ATIVOS COMPLETOS from Sinergy...');

  const envelope = buildEnvelopeAtivosCompleto(SINERGY_USER, SINERGY_PASS);
  const soapXml = await callSoapAtivosCompleto(envelope);
  const funcionarios = parseAtivosCompleto(soapXml);

  console.log(`✅ Sinergy returned ${funcionarios.length} active employees.`);

  if (funcionarios.length > 0) {
    const sample = funcionarios.slice(0, 2);
    console.log('� Sample from Sinergy (first 2):');
    for (const f of sample) {
      console.log(
        `  - ${f.func_nom} | CPF = ${f.func_num_cpf} | Matricula = ${f.func_num}`
      );
    }
  }

  return funcionarios;
}

// ================== PIPEFY – CHAMADA GENÉRICA ==================

async function callPipefy(query, variables) {
  if (!PIPEFY_TOKEN) {
    throw new Error('PIPEFY_TOKEN não definido no .env');
  }
  if (!PIPEFY_URL) {
    throw new Error('PIPEFY_ENDPOINT não definido no .env (ou default inválido)');
  }

  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PIPEFY_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('❌ Resposta Pipefy não é JSON:');
    console.error(text.slice(0, 800));
    throw new Error('Resposta Pipefy inválida (não-JSON)');
  }

  if (!res.ok) {
    console.error(`❌ HTTP Pipefy ${res.status}`);
    console.error(text.slice(0, 800));
    throw new Error(`Erro HTTP Pipefy ${res.status}`);
  }

  if (json.errors && json.errors.length > 0) {
    console.error('❌ Erros Pipefy:', JSON.stringify(json.errors, null, 2));
    throw new Error('Pipefy GraphQL retornou erros');
  }

  return json.data;
}

// ================== PIPEFY – CRIAR CARD A PARTIR DO FUNCIONÁRIO ==================

async function createPipefyCardFromEmployee(emp) {
  if (!PIPEFY_TOKEN || !PIPE_ID) {
    // manter essa validação, mas agora baseada em process.env diretamente
    throw new Error('PIPEFY_TOKEN ou PIPE_ID ausentes no .env');
  }

  const celularForm =
    emp.func_num_cel ||
    (emp.func_celular_ddd && emp.func_celular_numero
      ? `(${emp.func_celular_ddd}) ${emp.func_celular_numero}`
      : '');

  const fields = [
    { field_id: 'nome_do_colaborador',          field_value: emp.func_nom || '' },
    { field_id: 'e_mail_pessoal',              field_value: emp.func_email_pessoal || '' },
    { field_id: 'cpf',                         field_value: emp.func_num_cpf || '' },
    { field_id: 'rg',                          field_value: emp.func_num_rg || '' },
    { field_id: 'e_mail_edc',                  field_value: emp.func_email || '' },
    { field_id: 'n_mero_de_celular',           field_value: celularForm },
    { field_id: 'n_mero_de_telefone',          field_value: emp.func_num_tel_res || '' },
    { field_id: 'endere_o',                    field_value: emp.func_nom_end || '' },
    { field_id: 'c_digo_cidade',               field_value: emp.cid_cod || '' },
    { field_id: 'nome_cidade',                 field_value: emp.cid_nome || '' },
    { field_id: 'cep_cidade',                  field_value: emp.func_cod_cep || '' },
    { field_id: 'g_nero',                      field_value: emp.func_sts_sexo || '' },
    { field_id: 'estado_civil',                field_value: emp.estcv_cod || '' },
    { field_id: 'data_de_nascimento',          field_value: toIsoDateOrOriginal(emp.func_dat_nasc || '') },
    { field_id: 'data_de_admiss_o',            field_value: toIsoDateOrOriginal(emp.func_dat_adm_banco || '') },
    { field_id: 'nome_centro_de_custo',        field_value: emp.ccu_nom || '' },
    { field_id: 'c_digo_centro_de_custo',      field_value: emp.ccu_cod || '' },
    { field_id: 'status_colaborador',          field_value: emp.func_sts || '' },
    { field_id: 'data_demiss_o',               field_value: toIsoDateOrOriginal(emp.func_dat_dem || '') },
    { field_id: 'status_demiss_o',             field_value: emp.func_sts_dem || '' },
    { field_id: 'motivo_demiss_o',             field_value: emp.desc_motivo_rescisao || '' },
    { field_id: 'cargo',                       field_value: emp.desc_tipo_cargo || emp.desc_funcao_cargo || '' },
    { field_id: 'c_digo_local_de_trabalho',    field_value: emp.func_location || emp.func_local_trab_codigo || '' },
    { field_id: 'nome_local_de_trabalho',      field_value: emp.func_local_trabalho_descricao || '' },
    { field_id: 'cnpj_unidade',                field_value: emp.cnpj_unidade || '' },
    { field_id: 'mun_cipio_local_de_trabalho', field_value: emp.func_local_trabalho_municipio || '' },
    { field_id: 'escala_de_hor_rio_descri_o',  field_value: emp.desc_escala || '' },
    { field_id: 'nome_gestor',                 field_value: emp.gestor_nome || '' },
    { field_id: 'raz_o_social',                field_value: emp.razao_social || '' },
    { field_id: 'nome_do_v_nculo',             field_value: emp.nom_vinculo || '' },
    { field_id: 'nome_do_sindicato',           field_value: emp.nom_sindicato || '' },
    { field_id: 'matr_cula',                   field_value: emp.func_num || '' },
  ].filter(f => {
    if (f.field_value === null || f.field_value === undefined) return false;
    const s = String(f.field_value).trim();
    return s.length > 0;
  });

  const fieldsString = fields
    .map(
      f =>
        `{ field_id: "${f.field_id}", field_value: "${gqlEscape(
          f.field_value
        )}" }`
    )
    .join(',\n      ');

  const mutation = `
mutation {
  createCard(input: {
    pipe_id: ${Number(PIPE_ID)},
    fields_attributes: [
      ${fieldsString}
    ]
  }) {
    card {
      id
      title
    }
  }
}`;

  logDebug('Pipefy createCard mutation:', mutation);

  const data = await callPipefy(mutation, null);
  return data?.createCard?.card || null;
}

// ================== CARDS EXISTENTES NO PIPEFY (JSON) ==================

function loadPipefyCpfSet() {
  console.log(`� Reading Pipefy cards from: ${CARDS_FILE}`);

  if (!fs.existsSync(CARDS_FILE)) {
    throw new Error(`Arquivo ${CARDS_FILE} não encontrado.`);
  }

  const raw = fs.readFileSync(CARDS_FILE, 'utf8');
  const cards = JSON.parse(raw);

  if (!Array.isArray(cards)) {
    throw new Error('JSON de cards inválido (esperado array)');
  }

  console.log(`✅ Pipefy JSON contains ${cards.length} cards.`);

  const cpfSet = new Set();
  for (const card of cards) {
    const fields = card.fields || [];
    const cpfField = fields.find(f => f.name === 'CPF');
    if (!cpfField || !cpfField.value) continue;
    const digits = onlyDigits(cpfField.value);
    if (digits.length === 11) {
      cpfSet.add(digits);
    }
  }

  console.log(`✅ Distinct CPFs in Pipefy: ${cpfSet.size}`);
  return cpfSet;
}

// ================== MAIN ==================

async function main() {
  // log de sanidade dos envs
  logDebug('ENV check', {
    hasPipefyToken: !!PIPEFY_TOKEN,
    pipeId: PIPE_ID,
    sinergyEndpoint: SINERGY_ENDPOINT,
    cardsFile: CARDS_FILE,
  });

  if (!PIPEFY_TOKEN || !PIPE_ID) {
    throw new Error('PIPEFY_TOKEN ou PIPE_ID ausentes no .env');
  }

  const sinergyEmployees = await fetchActiveEmployeesFromSinergy();
  const pipefyCpfSet = loadPipefyCpfSet();

  const missing = [];
  for (const emp of sinergyEmployees) {
    const cpfDigits = onlyDigits(emp.func_num_cpf);
    if (!cpfDigits || cpfDigits.length !== 11) continue;
    if (!pipefyCpfSet.has(cpfDigits)) {
      missing.push(emp);
    }
  }

  console.log(
    `\n� Active employees in Sinergy NOT found in Pipefy by CPF: ${missing.length}`
  );

  if (missing.length > 0) {
    console.log('\n� List of employees from Sinergy that are NOT in Pipefy (by CPF):');
    for (const emp of missing) {
      console.log(
        ` - ${emp.func_nom} | CPF: ${emp.func_num_cpf} | Matrícula: ${emp.func_num}`
      );
    }
  }

  if (!missing.length) {
    console.log('\n� No missing employees to create. Finished.');
    return;
  }

  console.log('\n� Creating missing cards in Pipefy...\n');

  let created = 0;
  let failed = 0;

  for (const emp of missing) {
    const cpf = emp.func_num_cpf;
    const name = emp.func_nom;
    const matricula = emp.func_num;

    console.log(
      `➡️ Creating card for ${name} (CPF: ${cpf}, Mat: ${matricula})...`
    );

    try {
      const card = await createPipefyCardFromEmployee(emp);
      console.log(
        `   ✔️ Card created. ID=${card?.id || 'unknown'} | title="${card?.title ||
          ''}"`
      );
      created++;
    } catch (err) {
      console.error(
        `   ❌ Failed to create card for ${name} (${cpf}): ${err.message}`
      );
      if (DEBUG_BOOL) console.error(err);
      failed++;
    }
  }

  console.log('\n� Finished creating missing employees in Pipefy.');
  console.log({ created, failed, totalMissing: missing.length });
}

if (require.main === module) {
  main().catch(err => {
    console.error('Erro fatal em syncNewEmployees:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
