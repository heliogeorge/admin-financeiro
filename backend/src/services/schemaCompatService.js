const { adminDb } = require('../config/database');

const tableCache = new Map();
const columnCache = new Map();

async function hasTable(tableName) {
  if (tableCache.has(tableName)) return tableCache.get(tableName);
  const exists = await adminDb.schema.hasTable(tableName);
  tableCache.set(tableName, exists);
  return exists;
}

async function hasColumn(tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
  const exists = await adminDb.schema.hasColumn(tableName, columnName);
  columnCache.set(cacheKey, exists);
  return exists;
}

async function getExistingColumns(tableName, columnNames) {
  const entries = await Promise.all(
    columnNames.map(async (columnName) => [columnName, await hasColumn(tableName, columnName)])
  );

  return Object.fromEntries(entries);
}

function pickExistingFields(payload, existingColumns) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => existingColumns[key] && value !== undefined)
  );
}

module.exports = {
  hasTable,
  hasColumn,
  getExistingColumns,
  pickExistingFields,
};
