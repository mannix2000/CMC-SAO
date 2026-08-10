const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');

const REQUIRED_COLUMNS = ['studentNumber', 'lastName', 'firstName', 'course', 'yearLevel', 'section'];
const OPTIONAL_COLUMNS = ['middleName', 'email'];
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

function normalizeHeader(header) {
  const key = String(header || '').trim().toLowerCase().replace(/[\s_]+/g, '');
  const map = {
    studentnumber: 'studentNumber',
    studentid: 'studentNumber',
    lastname: 'lastName',
    firstname: 'firstName',
    middlename: 'middleName',
    course: 'course',
    program: 'course',
    yearlevel: 'yearLevel',
    year: 'yearLevel',
    section: 'section',
    email: 'email',
  };
  return map[key] || null;
}

function rowsFromCsv(buffer) {
  const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  if (records.length === 0) return [];
  const rawHeaders = Object.keys(records[0]);
  const headerMap = {};
  for (const h of rawHeaders) headerMap[h] = normalizeHeader(h);

  return records.map((record) => {
    const row = {};
    for (const h of rawHeaders) {
      const normalized = headerMap[h];
      if (normalized) row[normalized] = record[h];
    }
    return row;
  });
}

async function rowsFromXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = normalizeHeader(cell.value);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;
      let value = cell.value;
      if (value && typeof value === 'object' && 'text' in value) value = value.text;
      record[key] = value != null ? String(value).trim() : '';
    });
    if (Object.values(record).some((v) => v !== '' && v != null)) rows.push(record);
  });
  return rows;
}

/**
 * Validates and normalizes generic row objects (keys from ALL_COLUMNS).
 * Returns { validRows, errors } where errors reference the 1-based row number
 * (offset lets callers say "row 2 is the first data row" for files with a header, etc).
 */
function validateRows(rows, { rowNumberOffset = 2 } = {}) {
  const errors = [];
  const validRows = [];
  const seenInFile = new Set();

  rows.forEach((row, idx) => {
    const rowNum = idx + rowNumberOffset;
    const missing = REQUIRED_COLUMNS.filter((col) => !row[col] || String(row[col]).trim() === '');
    if (missing.length > 0) {
      errors.push(`Row ${rowNum}: missing ${missing.join(', ')}`);
      return;
    }
    const studentNumber = String(row.studentNumber).trim();
    if (seenInFile.has(studentNumber)) {
      errors.push(`Row ${rowNum}: duplicate studentNumber "${studentNumber}" in file`);
      return;
    }
    seenInFile.add(studentNumber);

    const cleaned = {};
    for (const col of ALL_COLUMNS) {
      cleaned[col] = row[col] ? String(row[col]).trim() : null;
    }
    cleaned.studentNumber = studentNumber;
    validRows.push(cleaned);
  });

  return { validRows, errors };
}

/**
 * Parses an uploaded roster file into normalized row objects and validates them.
 * Returns { validRows, errors } where errors reference the 1-based row number.
 */
async function parseRosterFile(file) {
  const isXlsx = /\.xlsx$/i.test(file.originalname) ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const rows = isXlsx ? await rowsFromXlsx(file.buffer) : rowsFromCsv(file.buffer);
  return validateRows(rows);
}

/**
 * Parses pasted spreadsheet rows (ID, Last Name, First Name — tab-separated, as copied
 * straight out of Excel) into normalized rows, applying a single Program/Year Level/Section
 * to every row in the batch.
 */
function parsePastedRows(text, { course, yearLevel, section }) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = lines.map((line) => {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
    const [studentNumber = '', lastName = '', firstName = ''] = cols.map((c) => c.trim());
    return { studentNumber, lastName, firstName, course, yearLevel, section };
  });

  return validateRows(rows, { rowNumberOffset: 1 });
}

module.exports = { parseRosterFile, parsePastedRows, REQUIRED_COLUMNS, OPTIONAL_COLUMNS };
