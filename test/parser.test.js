// Run: node test/parser.test.js
const assert = require('assert');
const { parse, toWords } = require('../parser.js');

let passed = 0, failed = 0;
function check(input, expected) {
  const got = parse(input).numbers.map(n => n.value);
  try {
    assert.deepStrictEqual(got, expected);
    passed++;
  } catch {
    failed++;
    console.log(`FAIL  "${input}"  expected ${JSON.stringify(expected)}  got ${JSON.stringify(got)}`);
  }
}

// --- Examples from the spec ---
check('אפס', [0]);
check('עשרים וחמש', [25]);
check('מאה ושבע', [107]);
check('תשע מאות תשעים ותשע', [999]);
check('אלפיים שלוש מאות ארבעים', [2340]);
check('מאה אלף', [100000]);
check('ארבע מאות עשרים ושלוש', [423]);
check('שמונים ושבע', [87]);
check('אלף מאתיים וחמישים', [1250]);
check('שלושים ושש', [36]);
check('מאה עשרים', [120]);
check('אלף חמש מאות שמונים', [1580]);
check('חמש עשרה', [15]);
check('אלף מאתיים', [1200]);
check('ארבע מאות שמונים', [480]);

// --- Several numbers in one transcript (spec §5) ---
check('ארבע מאות עשרים, שבעים ושמונה, מאה ועשרים וחמש', [420, 78, 125]);
check('ארבע מאות עשרים שבעים ושמונה מאה ועשרים וחמש', [420, 78, 125]);
check('עשרים ושלוש ארבע מאות', [23, 400]);
check('שבעים ושמונה מאה', [78, 100]);
check('חמש שש שבע', [5, 6, 7]);
// Known, inherent ambiguity: without a pause this is a valid single number.
check('ארבע מאות שמונים אלף מאתיים', [480200]);

// --- Masculine / construct / spelling variants ---
check('חמישה עשר', [15]);
check('שנים עשר', [12]);
check('שתים עשרה', [12]);
check('שלושת אלפים', [3000]);
check('שלוש אלף', [3000]);
check('עשרת אלפים', [10000]);
check('אחד עשר אלף', [11000]);
check('עשרים ושלושה אלף', [23000]);
check('מאתיים וחמישים אלף', [250000]);
check('שני מיליון', [2000000]);
check('מיליון שלוש מאות אלף', [1300000]);
check('מליון', [1000000]);
check('שלש מאות', [300]);
check('ו שבע', [7]);
check('מאה ו-שבע', [107]);

// --- Recogniser returning digits (Chrome often does inverse text normalisation) ---
check('423', [423]);
check('1,250', [1250]);
check('420 78 125', [420, 78, 125]);
check('3 מאות', [300]);
check('מאה ו-7', [107]);
check('מאה ו7', [107]);

// --- Noise ---
{
  const r = parse('אה עשרים ושלוש');
  assert.deepStrictEqual(r.numbers.map(n => n.value), [23]);
  assert.deepStrictEqual(r.unknown, ['אה']);
  passed++;
}
check('שלום', []);
check('', []);

// --- Round trip: every number → words → number ---
let rtFail = 0;
const sample = [];
for (let n = 0; n <= 20000; n++) sample.push(n);
for (let n = 20000; n <= 9999999; n += 7919) sample.push(n);
sample.push(100000, 999999, 1000000, 1000001, 2002000, 9999999);
for (const n of sample) {
  const words = toWords(n);
  const got = parse(words).numbers.map(x => x.value);
  if (got.length !== 1 || got[0] !== n) {
    if (rtFail++ < 10) console.log(`ROUND-TRIP FAIL ${n}: "${words}" → ${JSON.stringify(got)}`);
  }
}
if (rtFail) failed++; else passed++;

console.log(`\n${passed} passed, ${failed} failed (round trip over ${sample.length} numbers${rtFail ? `, ${rtFail} failures` : ''})`);
process.exit(failed ? 1 : 0);
