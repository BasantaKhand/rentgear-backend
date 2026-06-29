// Escape a single CSV cell: wrap in quotes if it contains comma, quote or newline,
// and double up embedded quotes.
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Build a CSV string from an array of objects and a column mapping.
// columns: [{ key, label, format? }]
//   key    - property on each row (or used by format)
//   label  - header text
//   format - optional (row) => value transformer
function generateCsv(rows, columns) {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.format ? c.format(row) : row[c.key];
        return escapeCell(raw);
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
}

// Set the response headers for a CSV file download.
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

module.exports = { generateCsv, sendCsv, escapeCell };
