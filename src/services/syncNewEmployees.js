// src/services/syncNewEmployees.js
const fs = require('fs');
const {
  CARDS_JSON_FILE,
  PIPE_ID,
  DEBUG,
} = require('../config/env');
const { callPipefy } = require('../infra/pipefyClient');
const { fetchActiveEmployeesFromSinergy } = require('../infra/sinergyClient');
const {
  onlyDigits,
  gqlEscape,
  toIsoDateOrOriginal,
} = require('../utils');

const DEBUG_BOOL = !!DEBUG;

function logDebug(...args) {
  if (DEBUG_BOOL) console.log('[DEBUG syncNewEmployees]', ...args);
}

// ================== CARDS EXISTENTES NO PIPEFY (JSON) ==================

function loadPipefyCpfSet() {
  console.log(`📄 Reading Pipefy cards from: ${CARDS_JSON_FILE}`);

  if (!fs.existsSync(CARDS_JSON_FILE)) {
    throw new Error(`Arquivo ${CARDS_JSON_FILE} não encontrado.`);
  }

  const raw = fs.readFileSync(CARDS_JSON_FILE, 'utf8');
  const cards = JSON.parse(raw);

  if (!Array.isArray(cards)) {
    throw new Error('JSON de cards inválido (esperado array)');
  }

  console.log(`✅ Pipefy JSON contains ${cards.length} cards.`);

  const cpfSet = new Set();
  for (const card of cards) {
    const fields = card.fields || [];
    const cpfField = fields.find((f) => f.name === 'CPF');
    if (!cpfField || !cpfField.value) continue;
    const digits = onlyDigits(cpfField.value);
    if (digits.length === 11) {
      cpfSet.add(digits);
    }
  }

  console.log(`✅ Distinct CPFs in Pipefy: ${cpfSet.size}`);
  return cpfSet;
}

// ================== PIPEFY – CRIAR CARD A PARTIR DO FUNCIONÁRIO ==================

async function createPipefyCardFromEmployee(emp) {
  if (!PIPE_ID) {
    throw new Error('PIPE_ID ausente no .env');
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

// ================== MAIN SERVICE ==================

async function syncNewEmployees() {
  logDebug('ENV check', {
    pipeId: PIPE_ID,
    cardsFile: CARDS_JSON_FILE,
  });

  if (!PIPE_ID) {
    throw new Error('PIPE_ID ausente no .env');
  }

  // 1) Funcionários ativos do Sinergy
  const sinergyEmployees = await fetchActiveEmployeesFromSinergy();

  // 2) CPFs já existentes no Pipefy (do JSON)
  const pipefyCpfSet = loadPipefyCpfSet();

  // 3) Descobrir quem está no Sinergy mas não no Pipefy
  const missing = [];
  for (const emp of sinergyEmployees) {
    const cpfDigits = onlyDigits(emp.func_num_cpf);
    if (!cpfDigits || cpfDigits.length !== 11) continue;
    if (!pipefyCpfSet.has(cpfDigits)) {
      missing.push(emp);
    }
  }

  console.log(
    `\n👥 Active employees in Sinergy NOT found in Pipefy by CPF: ${missing.length}`
  );

  if (missing.length > 0) {
    console.log('\n📃 List of employees from Sinergy that are NOT in Pipefy (by CPF):');
    for (const emp of missing) {
      console.log(
        ` - ${emp.func_nom} | CPF: ${emp.func_num_cpf} | Matrícula: ${emp.func_num}`
      );
    }
  }

  if (!missing.length) {
    console.log('\n✅ No missing employees to create. Finished.');
    return;
  }

  console.log('\n🧾 Creating missing cards in Pipefy...\n');

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

  console.log('\n🏁 Finished creating missing employees in Pipefy.');
  console.log({ created, failed, totalMissing: missing.length });
}

// Permite rodar direto: node src/services/syncNewEmployees.js
if (require.main === module) {
  syncNewEmployees().catch(err => {
    console.error('Erro fatal em syncNewEmployees:', err.message);
    process.exit(1);
  });
}

module.exports = {
  syncNewEmployees,
  // alias para compatibilidade, se em algum lugar você ainda usa "main"
  main: syncNewEmployees,
};