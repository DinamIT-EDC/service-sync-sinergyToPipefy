// src/utils.js

function escapeXml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function onlyDigits(s) {
  return (s || '').replace(/\D+/g, '');
}

// "48917993826" -> "489.179.938-26"
function formatCpfMask(digits) {
  const d = onlyDigits(digits);
  if (d.length !== 11) return digits || '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// Escapa string para ser usada DENTRO de um mutation GraphQL literal
function gqlEscape(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// Converte "dd/MM/yyyy" -> "yyyy-MM-dd" (se não bater, devolve original)
function toIsoDateOrOriginal(str) {
  if (!str) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim());
  if (!m) return str;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function normalize(v) {
  if (v == null) return '';
  return String(v).trim();
}

module.exports = {
  escapeXml,
  onlyDigits,
  formatCpfMask,
  gqlEscape,
  toIsoDateOrOriginal,
  normalize,
};
