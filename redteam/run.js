// Terminal version of the red-team suite. Usage: node redteam/run.js [G01 G09 ...]   (exit code 1 if anything fails)
'use strict';
const { runAll } = require('./engine');
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const only = process.argv.slice(2).filter((a) => /^[BG]\d\d$/.test(a));
runAll((e) => {
  if (e.type === 'start') process.stdout.write(`\n${C.c}[${e.id}]${C.x} `);
  if (e.type === 'suite') console.log(`${e.tests.length} tests`);
  if (e.type === 'start') { /* title printed with end */ }
  if (e.type === 'attack') console.log(`${C.y}  >> ${e.text}${C.x}`);
  if (e.type === 'log') console.log(`${C.d}  ${e.line}${C.x}`);
  if (e.type === 'check' && !e.ok) console.log(`${C.r}  FAIL ${e.name}${e.detail ? ' — ' + e.detail : ''}${C.x}`);
  if (e.type === 'end') console.log(`  ${e.pass ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${e.passed}/${e.total} checks, ${e.ms} ms`);
  if (e.type === 'done') console.log(`\n${e.failed ? C.r : C.g}${e.passed} passed, ${e.failed} failed (${e.checks} checks)${C.x}`);
}, { only: only.length ? only : null }).then((s) => process.exit(s.failed ? 1 : 0));
