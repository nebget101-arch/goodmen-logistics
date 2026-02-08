// Utility function to convert snake_case to camelCase
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

// Utility function to convert camelCase to snake_case
function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// Transform database row from snake_case to camelCase
function transformRow(row) {
  if (!row) return row;
  
  const transformed = {};
  for (const key in row) {
    const camelKey = toCamelCase(key);
    transformed[camelKey] = row[key];
  }
  return transformed;
}

// Transform array of database rows
function transformRows(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(transformRow);
}

module.exports = {
  toCamelCase,
  toSnakeCase,
  transformRow,
  transformRows
};
