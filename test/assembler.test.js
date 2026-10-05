// Run: node test/assembler.test.js
const assert = require('assert');
const { parse } = require('../parser.js');
const { createAssembler } = require('../assembler.js');

let passed = 0, failed = 0;

// Feeds each transcript as one final result; `pause` between them lets the timer fire.
function run(transcripts, { length = 6 } = {}) {
  const commits = [];
  let timer = null;
  const asm = createAssembler({
    length,
    onCommit: c => commits.push({ digits: c.digits, certain: c.certain }),
    schedule: fn => { timer = fn; return () => { timer = null; }; },
  });
  for (const t of transcripts) {
    if (t === 'pause') { if (timer) timer(); continue; }
    const p = parse(t);
    asm.push(p.numbers.map(n => n.value), { uncertain: p.unknown.length > 0, source: t });
  }
  if (timer) timer();
  return commits;
}

function check(name, transcripts, expected) {
  const got = run(transcripts);
  try {
    assert.deepStrictEqual(got, expected);
    passed++;
  } catch {
    failed++;
    console.log(`FAIL  ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`);
  }
}
const ok = d => ({ digits: d, certain: true });
const unsure = d => ({ digits: d, certain: false });

// --- Ways of reading 254798 ---
check('full form, one result', ['מאתיים חמישים וארבעה אלף שבע מאות תשעים ושמונה'], [ok('254798')]);
check('pause after אלף', ['מאתיים חמישים וארבעה אלף', 'שבע מאות תשעים ושמונה'], [ok('254798')]);
check('two triplets, one result', ['מאתיים חמישים וארבע שבע מאות תשעים ושמונה'], [ok('254798')]);
check('two triplets, two results', ['מאתיים חמישים וארבע', 'שבע מאות תשעים ושמונה'], [ok('254798')]);
check('three pairs', ['עשרים וחמש', 'ארבעים ושבע', 'תשעים ושמונה'], [ok('254798')]);
check('digit by digit', ['שתיים חמש ארבע שבע תשע שמונה'], [ok('254798')]);
check('recogniser digits', ['254798'], [ok('254798')]);
check('recogniser digits with space', ['254 798'], [ok('254798')]);
check('recogniser digits with comma', ['254,798'], [ok('254798')]);
check('mixed digits and words', ['254 אלף 798'], [ok('254798')]);
check('ASR dropped אלף', ['מאתיים חמישים וארבע שבע מאות תשעים ושמונה'], [ok('254798')]);

// --- Zeros ---
check('zero in the middle, triplets', ['מאתיים חמישים וארבע', 'אפס תשעים ושמונה'], [ok('254098')]);
check('full form with zero hundreds', ['מאתיים חמישים וארבעה אלף תשעים ושמונה'], [ok('254098')]);
check('round thousands, then pause', ['מאתיים חמישים וארבעה אלף', 'pause'], [ok('254000')]);
check('round thousands followed by another number',
  ['מאתיים חמישים וארבעה אלף', 'שלוש מאות אלף מאה ועשר'], [ok('254000'), ok('300110')]);

// --- Several numbers in a row ---
check('three numbers, full form, separate results',
  ['מאה עשרים ושלושה אלף ארבע מאות חמישים ושש', 'שש מאות חמישים וארבעה אלף שלוש מאות עשרים ואחת', '999999'],
  [ok('123456'), ok('654321'), ok('999999')]);
check('two numbers in one result', ['123456 654321'], [ok('123456'), ok('654321')]);

// --- Must NOT be accepted silently ---
check('too short then pause', ['מאתיים חמישים וארבע', 'תשעים ושמונה', 'pause'], [unsure('25498')]);
check('too long', ['מיליון מאתיים אלף'], [unsure('1200000')]);
check('unclear word', ['מאתיים חמישים וארבעה אלף שבע מאות אה תשעים ושמונה'], [unsure('254798')]);
check('nothing heard', ['שלום'], []);

// --- Any-length mode passes numbers straight through ---
{
  const commits = [];
  const asm = createAssembler({ length: 0, onCommit: c => commits.push(c.digits) });
  asm.push([23, 480]);
  try { assert.deepStrictEqual(commits, ['23', '480']); passed++; } catch { failed++; console.log('FAIL any-length'); }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
