// Runs the attack list and reports every step as an event: { type: 'suite' | 'start' | 'log' | 'attack' | 'defence' | 'check' | 'end' | 'done', ... }.
// The dashboard (server.js) streams these live; run.js prints them in the terminal. Writes redteam/out/report.json at the end.
'use strict';
const fs = require('fs');
const path = require('path');
const { tests } = require('./attacks');

async function runAll(emit, { only, pace = 0 } = {}) {
  const list = tests.filter((t) => !only || only.includes(t.id));
  const wait = () => (pace ? new Promise((r) => setTimeout(r, pace)) : null);
  emit({ type: 'suite', tests: list.map(({ id, hat, area, title }) => ({ id, hat, area, title })), at: Date.now() });
  const report = [];
  for (const def of list) {
    const checks = [], logs = [];
    const started = Date.now();
    emit({ type: 'start', id: def.id });
    const t = {
      log: (line) => { logs.push(String(line)); emit({ type: 'log', id: def.id, line: String(line) }); },
      attack: (text) => { logs.push('ATTACK ' + text); emit({ type: 'attack', id: def.id, text: String(text) }); },
      defence: (text) => { logs.push('DEFENCE ' + text); emit({ type: 'defence', id: def.id, text: String(text) }); },
      check: (name, ok, detail) => {
        // ok === null: the check could not run (for example n8n is not started); shown as skipped, not as passed
        const c = { name, ok: ok === null ? null : Boolean(ok), detail: detail === undefined || ok === true ? '' : String(detail).slice(0, 300) };
        checks.push(c);
        emit({ type: 'check', id: def.id, ...c });
      },
    };
    let error = '';
    try { await def.run(t); } catch (e) { error = String((e && e.stack) || e).split('\n').slice(0, 4).join('\n'); t.log('ERROR ' + error); }
    const skipped = !error && checks.length > 0 && checks.every((c) => c.ok === null);
    const pass = !error && !skipped && checks.length > 0 && checks.every((c) => c.ok !== false);
    const r = { id: def.id, hat: def.hat, area: def.area, title: def.title, pass, skipped, error, ms: Date.now() - started, checks, logs };
    report.push(r);
    emit({ type: 'end', id: def.id, pass, skipped, ms: r.ms, passed: checks.filter((c) => c.ok).length, total: checks.length, error });
    await wait();
  }
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const summary = { at: new Date().toISOString(), passed: report.filter((r) => r.pass).length, failed: report.filter((r) => !r.pass && !r.skipped).length, skipped: report.filter((r) => r.skipped).length,
    checks: report.reduce((s, r) => s + r.checks.length, 0), report };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 2));
  emit({ type: 'done', passed: summary.passed, failed: summary.failed, skipped: summary.skipped, checks: summary.checks });
  return summary;
}
module.exports = { runAll };
