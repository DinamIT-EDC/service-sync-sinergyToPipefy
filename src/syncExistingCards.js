// src/syncExistingCards.js
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const {
  PIPEFY_TOKEN,
  PIPEFY_ENDPOINT,
  CARDS_JSON_FILE,
  SINERGY_ENDPOINT,
  SINERGY_USER,
  SINERGY_PASS,
  SINERGY_SOAP_ACTION_BY_CPF,
  DEBUG,
} = require('./env');
const {
  escapeXml,
  onlyDigits,
  formatCpfMask,
  gqlEscape,
  toIsoDateOrOriginal,
  normalize,
} = require('./utils');

// ================== MAPEAMENTOS ==================

// 1) Nomes "lógicos" -> field_id do Pipefy
const PIPEFY_FIELD_ID_MAP = {
  nome_colaborador:         'nome_do_colaborador',
  email_pessoal:            'e_mail_pessoal',
  cpf:                      'cpf',
  rg:                       'rg',
  email_corporativo:        'e_mail_edc',
  celular:                  'n_mero_de_celular',
  telefone_residencial:     'n_mero_de_telefone',
  endereco:                 'endere_o',
  cidade_codigo:            'c_digo_cidade',
  cidade_nome:              'nome_cidade',
  cep:                      'cep_cidade',
  genero:                   'g_nero',
  estado_civil:             'estado_civil',
  data_nascimento:          'data_de_nascimento',
  data_admissao:            'data_de_admiss_o',
  centro_custo_nome:        'nome_centro_de_custo',
  centro_custo_codigo:      'c_digo_centro_de_custo',
  status_colaborador:       'status_colaborador',
  data_demissao:            'data_demiss_o',
  status_demissao:          'status_demiss_o',
  motivo_demissao:          'motivo_demiss_o',
  cargo:                    'cargo',
  local_trabalho_codigo:    'c_digo_local_de_trabalho',
  local_trabalho_nome:      'nome_local_de_trabalho',
  cnpj_unidade:             'cnpj_unidade',
  municipio_local_trabalho: 'mun_cipio_local_de_trabalho',
  escala_descricao:         'escala_de_hor_rio_descri_o',
  gestor_nome:              'nome_gestor',
  razao_social:             'raz_o_social',
  vinculo_nome:             'nome_do_v_nculo',
  sindicato_nome:           'nome_do_sindicato',
  matricula:                'matr_cula',
};

// 2) Nomes "lógicos" -> labels (name) no JSON do Pipefy
const PIPEFY_LABEL_MAP = {
  nome_colaborador:         'Nome do colaborador',
  email_pessoal:            'E-mail Pessoal',
  cpf:                      'CPF',
  rg:                       'RG',
  email_corporativo:        'E-mail Corporativo (EDC)',
  celular:                  'Número de Celular',
  telefone_residencial:     'Número de Telefone',
  endereco:                 'Endereço Logradouro',
  cidade_codigo:            '[DESATIVADO] Código Cidade',
  cidade_nome:              'Nome Cidade',
  cep:                      'CEP Cidade',
  genero:                   'Gênero',
  estado_civil:             'Estado Civil',
  data_nascimento:          'Data de Nascimento',
  data_admissao:            'Data de Admissão',
  centro_custo_nome:        'Nome Centro de Custo ',
  centro_custo_codigo:      'Código Centro de Custo',
  status_colaborador:       'Status Colaborador',
  data_demissao:            'Data Demissão',
  status_demissao:          'Status Demissão',
  motivo_demissao:          'Motivo Demissão',
  cargo:                    'Cargo',
  local_trabalho_codigo:    '[DESATIVADO] Código Local de Trabalho',
  local_trabalho_nome:      'Nome Local de Trabalho',
  cnpj_unidade:             'CNPJ Unidade',
  municipio_local_trabalho: 'Munícipio Local de Trabalho',
  escala_descricao:         'Escala de Horário Descrição',
  gestor_nome:              'Nome Gestor',
  razao_social:             'Razão Social',
  vinculo_nome:             'Nome do Vínculo',
  sindicato_nome:           'Nome do Sindicato',
  matricula:                'Matrícula',
};

const PIPEFY_CPF_LABEL = PIPEFY_LABEL_MAP.cpf;

// ================== PIPEFY – FUNÇÕES ==================

async function callPipefy(query, variables) {
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
    console.error('Pipefy GraphQL errors:', JSON.stringify(json.errors, null, 2));
    throw new Error('Pipefy GraphQL returned errors');
  }

  return json.data;
}

// Atualiza campos usando múltiplos updateCardField em uma única mutation
async function updateCardFields(cardId, canonicalData, diffKeys) {
  const operations = [];

  for (const key of diffKeys) {
    const fieldId = PIPEFY_FIELD_ID_MAP[key];
    if (!fieldId) continue;

    const value = canonicalData[key] == null ? '' : String(canonicalData[key]);
    const escapedValue = gqlEscape(value);

    const alias = `f_${fieldId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    operations.push(`
      ${alias}: updateCardField(
        input: {
          card_id: "${cardId}",
          field_id: "${fieldId}",
          new_value: "${escapedValue}"
        }
      ) {
        card { id }
      }
    `);
  }

  if (!operations.length) return;

  const mutation = `
    mutation {
      ${operations.join('\n')}
    }
  `;

  await callPipefy(mutation, {});
}

// Lê campos do card usando os LABELS do JSON (PIPEFY_LABEL_MAP)
function buildCanonicalFromPipefyCard(card) {
  const canonical = {};
  const fields = card.fields || [];

  for (const [logicalKey, label] of Object.entries(PIPEFY_LABEL_MAP)) {
    const field = fields.find((f) => f.name === label);
    let value = field ? field.value : '';

    if (logicalKey === 'cpf') {
      value = formatCpfMask(value);
    } else if (
      logicalKey === 'data_nascimento' ||
      logicalKey === 'data_admissao' ||
      logicalKey === 'data_demissao'
    ) {
      value = toIsoDateOrOriginal(value);
    }

    canonical[logicalKey] = value ?? '';
  }

  return canonical;
}

// Extrai o CPF do card usando o label "CPF"
function extractCpfDigitsFromCard(card) {
  const fields = card.fields || [];
  const field = fields.find((f) => f.name === PIPEFY_CPF_LABEL);

  if (!field || !field.value) return '';
  return onlyDigits(field.value);
}

// ================== SINERGY – FUNÇÕES ===================

const parserOpts = {
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
};

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

async function callSoap(envelope, soapAction) {
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
    console.error(`❌ SOAP HTTP ${res.status} ${res.statusText}`);
    console.error(xml.slice(0, 800));
    throw new Error(`SOAP HTTP error ${res.status}`);
  }

  return xml;
}

function parseFuncionarioFromSoap(soapXml, cpfSolicitadoDigits) {
  const parser = new XMLParser(parserOpts);
  const soapObj = parser.parse(soapXml);

  const body = soapObj?.Envelope?.Body;
  if (!body) throw new Error('SOAP Body missing.');

  if (body.Fault || body.fault) {
    console.error('❌ SOAP Fault:', body.Fault || body.fault);
    throw new Error('SOAP Fault returned by service.');
  }

  const result =
    body?.getDadosFuncionariosPorCpfResponse?.getDadosFuncionariosPorCpfResult;

  if (!result || typeof result !== 'string') {
    if (DEBUG) {
      console.log('[DEBUG] getDadosFuncionariosPorCpfResult missing or not string.');
      console.dir(body, { depth: 5 });
    }
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

async function getFuncionarioSinergyByCpf(cpfDigits) {
  const mascara = formatCpfMask(cpfDigits);
  const envelope = buildEnvelopeByCpf(SINERGY_USER, SINERGY_PASS, mascara);
  const soapXml = await callSoap(envelope, SINERGY_SOAP_ACTION_BY_CPF);
  const f = parseFuncionarioFromSoap(soapXml, cpfDigits);
  return f;
}

// Monta objeto canônico a partir da Sinergy (espelhando criação de card)
function buildCanonicalFromSinergy(funcData, cpfDigits) {
  const celularForm =
    funcData.func_num_cel ||
    (funcData.func_celular_ddd && funcData.func_celular_numero
      ? `(${funcData.func_celular_ddd}) ${funcData.func_celular_numero}`
      : '');

  const canonical = {
    nome_colaborador:         funcData.func_nom || '',
    email_pessoal:            funcData.func_email_pessoal || '',
    cpf:                      formatCpfMask(funcData.func_num_cpf || cpfDigits),
    rg:                       funcData.func_num_rg || '',
    email_corporativo:        funcData.func_email || '',
    celular:                  celularForm,
    telefone_residencial:     funcData.func_num_tel_res || '',
    endereco:                 funcData.func_nom_end || '',
    cidade_codigo:            funcData.cid_cod || '',
    cidade_nome:              funcData.cid_nome || '',
    cep:                      funcData.func_cod_cep || '',
    genero:                   funcData.func_sts_sexo || '',
    estado_civil:             funcData.estcv_cod || '',
    data_nascimento:          toIsoDateOrOriginal(funcData.func_dat_nasc || ''),
    data_admissao:            toIsoDateOrOriginal(funcData.func_dat_adm_banco || ''),
    centro_custo_nome:        funcData.ccu_nom || '',
    centro_custo_codigo:      funcData.ccu_cod || '',
    status_colaborador:       funcData.func_sts || '',
    data_demissao:            toIsoDateOrOriginal(funcData.func_dat_dem || ''),
    status_demissao:          funcData.func_sts_dem || '',
    motivo_demissao:          funcData.desc_motivo_rescisao || '',
    cargo:                    funcData.desc_tipo_cargo || funcData.desc_funcao_cargo || '',
    local_trabalho_codigo:    funcData.func_location || funcData.func_local_trab_codigo || '',
    local_trabalho_nome:      funcData.func_local_trabalho_descricao || '',
    cnpj_unidade:             funcData.cnpj_unidade || '',
    municipio_local_trabalho: funcData.func_local_trabalho_municipio || '',
    escala_descricao:         funcData.desc_escala || '',
    gestor_nome:              funcData.gestor_nome || '',
    razao_social:             funcData.razao_social || '',
    vinculo_nome:             funcData.nom_vinculo || '',
    sindicato_nome:           funcData.nom_sindicato || '',
    matricula:                funcData.func_num || '',
  };

  return canonical;
}

// ================== COMPARAÇÃO ==================

function findDifferences(canonicalPipefy, canonicalSinergy) {
  const diffs = {};

  for (const key of Object.keys(PIPEFY_FIELD_ID_MAP)) {
    const a = normalize(canonicalPipefy[key]);
    const b = normalize(canonicalSinergy[key]);

    if (a !== b) {
      diffs[key] = { pipefy: a, sinergy: b };
    }
  }

  return diffs;
}

// ================== MAIN ==================

async function syncExistingCards() {
  if (!PIPEFY_TOKEN) throw new Error('PIPEFY_TOKEN not defined');
  if (!SINERGY_USER || !SINERGY_PASS) {
    throw new Error('SINERGY_USER or SINERGY_PASS not defined');
  }
  if (!fs.existsSync(CARDS_JSON_FILE)) {
    throw new Error(`File ${CARDS_JSON_FILE} not found.`);
  }

  const raw = fs.readFileSync(CARDS_JSON_FILE, 'utf8');
  const cards = JSON.parse(raw);

  if (!Array.isArray(cards) || !cards.length) {
    console.log('No cards found in JSON.');
    return;
  }

  console.log(`Starting validation of ${cards.length} cards...\n`);

  let ok = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  let index = 0;

  for (const card of cards) {
    index += 1;
    const cardId = card.id;
    console.log(`\n[${index}/${cards.length}] Card ${cardId} - ${card.title || ''}`);

    try {
      const cpfDigits = extractCpfDigitsFromCard(card);

      if (!cpfDigits) {
        console.warn(`Card ${cardId}: CPF not found, skipping...`);
        skipped++;
        continue;
      }

      // 1) Consulta Sinergy
      let sinergyData;
      try {
        sinergyData = await getFuncionarioSinergyByCpf(cpfDigits);
      } catch (err) {
        console.error(
          `Error calling Sinergy for CPF ${formatCpfMask(cpfDigits)}:`,
          err.message
        );
        errors++;
        continue;
      }

      if (!sinergyData) {
        console.warn(
          `Card ${cardId}: no data from Sinergy for CPF ${formatCpfMask(
            cpfDigits
          )}, skipping...`
        );
        skipped++;
        continue;
      }

      const canonicalSinergy = buildCanonicalFromSinergy(sinergyData, cpfDigits);

      // Se quiser filtrar por status (ATV/DMT), pode manter:
      const status = normalize(canonicalSinergy.status_colaborador);
      if (!status) {
        console.log(
          `No status_colaborador in Sinergy data ("${status}"). Skipping card...`
        );
        skipped++;
        continue;
      }

      // 2) Comparar campos
      const canonicalPipefy = buildCanonicalFromPipefyCard(card);
      const diffs = findDifferences(canonicalPipefy, canonicalSinergy);
      const diffKeys = Object.keys(diffs);

      if (diffKeys.length === 0) {
        console.log('All relevant fields are equal, nothing to update.');
        ok++;
      } else {
        console.log(`Different fields: ${diffKeys.join(', ')}`);
        if (DEBUG) {
          console.log(JSON.stringify(diffs, null, 2));
        }

        try {
          await updateCardFields(cardId, canonicalSinergy, diffKeys);
          console.log('Card updated with Sinergy data.');
          updated++;
        } catch (err) {
          console.error(
            `Error updating fields for card ${cardId}:`,
            err.message
          );
          errors++;
        }
      }
    } catch (err) {
      console.error(
        `Unexpected error when processing card ${card.id}:`,
        err.message
      );
      if (DEBUG) console.error(err);
      errors++;
    }
  }

  console.log('\n🏁 Validation process finished.');
  console.log({
    ok,
    updated,
    skipped,
    errors,
    total: cards.length,
  });
}

// Permite rodar direto: node src/syncExistingCards.js
if (require.main === module) {
  syncExistingCards().catch((err) => {
    console.error('Fatal error in syncExistingCards:', err.message);
    process.exit(1);
  });
}

module.exports = { syncExistingCards };
