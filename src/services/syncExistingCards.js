// src/services/syncExistingCards.js
const fs = require('fs');
const {
  CARDS_JSON_FILE,
} = require('../config/env');
const { callPipefy } = require('../infra/pipefyClient');
const { getFuncionarioByCpf } = require('../infra/sinergyClient');
const {
  onlyDigits,
  formatCpfMask,
  gqlEscape,
  toIsoDateOrOriginal,
  normalize,
} = require('../utils');

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

// ================== SINERGY – CANÔNICO ===================

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

      // 1) Consulta Sinergy (via infra)
      let sinergyData;
      try {
        sinergyData = await getFuncionarioByCpf(cpfDigits);
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

// Permite rodar direto: node src/services/syncExistingCards.js
if (require.main === module) {
  syncExistingCards().catch((err) => {
    console.error('Fatal error in syncExistingCards:', err.message);
    process.exit(1);
  });
}

module.exports = { syncExistingCards };