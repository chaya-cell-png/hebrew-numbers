// Run: node test/xlsx.test.js [out.xlsx]
// Writes a sample workbook; test/verify_xlsx.py reads it back with openpyxl.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildXlsx, crc32 } = require('../xlsx.js');

// CRC-32 of "123456789" is the standard check value.
assert.strictEqual(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);

const bytes = buildXlsx({
  sheetName: 'מספרים',
  colWidths: [14],
  rows: [['מספר'], [254798], [999999], ['054798'], [0], ['<&"טקסט">']],
});
assert.strictEqual(bytes[0], 0x50); // "PK"
assert.strictEqual(bytes[1], 0x4B);

const out = process.argv[2] || path.join(require('os').tmpdir(), 'hebrew-numbers-sample.xlsx');
fs.writeFileSync(out, bytes);
console.log('xlsx ok →', out);
