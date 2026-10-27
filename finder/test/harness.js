// Runs D1's Code nodes outside n8n against the live job sites (no Google, no AI).
// Usage: node finder/test/harness.js --profile=alex|maria [--no-linkedin]   Output goes to finder/test/out/<profile>/.
'use strict';
const fs = require('fs');
const path = require('path');
const PROFILE = (process.argv.find((a) => a.startsWith('--profile=')) || '--profile=alex').slice(10);
const profile = require(`../profiles/${PROFILE}.js`);
const wf = require(`../workflows/${PROFILE}/D1Finder.json`);
const OUT = path.join(__dirname, 'out', PROFILE);
fs.mkdirSync(OUT, { recursive: true });

const results = {};
const node = (name) => wf.nodes.find((n) => n.name === name);
// n8n-like helpers.httpRequest on top of fetch.
async function httpRequest(o) {
  const u = new URL(o.url);
  for (const [k, v] of Object.entries(o.qs || {})) u.searchParams.set(k, v);
  const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  const headers = { ...(o.headers || {}), ...(body && typeof o.body !== 'string' ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(u, { method: o.method || 'GET', headers, body, redirect: o.disableFollowRedirect ? 'manual' : 'follow', signal: AbortSignal.timeout(o.timeout || 30000) });
  const text = await r.text();
  if (!o.ignoreHttpStatusErrors && r.status >= 400) throw new Error(`Request failed with status code ${r.status}`);
  let out = text;
  if (o.json || /json/.test(r.headers.get('content-type') || '')) { try { out = JSON.parse(text); } catch { /* keep text */ } }
  return o.returnFullResponse ? { statusCode: r.status, body: out, headers: Object.fromEntries(r.headers) } : out;
}
const luxon = (() => { try { return require(path.join(process.env.APPDATA, 'npm/node_modules/n8n/node_modules/luxon')); } catch { return require('luxon'); } })();
async function run(name, input = []) {
  const js = node(name).parameters.jsCode;
  const $ = (n) => { if (!(n in results)) throw new Error(`node ${n} has not run`); const items = results[n]; return { all: () => items, first: () => items[0] }; };
  const $input = { all: () => input, first: () => input[0] };
  const fn = new Function('$', '$input', '$now', 'DateTime', `return (async function () {\n${js}\n}).call(this);`);
  const t = Date.now();
  const out = await fn.call({ helpers: { httpRequest } }, $, $input, luxon.DateTime.now(), luxon.DateTime);
  results[name] = out;
  fs.writeFileSync(path.join(OUT, name.replace(/[^\w]+/g, '_') + '.json'), JSON.stringify(out.map((i) => i.json), null, 2));
  console.log(`${name}: ${out.length} items in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return out;
}

(async () => {
  const cfg = await run('Config');
  cfg[0].json.digestEmail = 'test@example.com';
  if (process.argv.includes('--no-linkedin')) cfg[0].json.useLinkedIn = false;
  const boards = await run('Fetch Job Boards');
  console.log(JSON.stringify(boards[boards.length - 1].json._stats, null, 1));
  results['Adzuna Search'] = [{ json: {} }];
  const li = await run('Fetch LinkedIn');
  console.log(JSON.stringify(li[li.length - 1].json._stats));
  const all = await run('Combine & Filter');
  console.log('total', all[all.length - 1].json.total, 'unique', all[all.length - 1].json.unique);
  results['Get Jobs Already Logged'] = [{ json: {} }];
  results['Get Seen Jobs'] = [{ json: {} }];
  const fresh = await run('New Jobs Only');
  const det = await run('Get Job Details', fresh);
  const vr = await run('Visa & Rates', det);
  console.log('visa registers', JSON.stringify(vr[0].json.registers), 'sponsors', JSON.stringify(vr[0].json.sponsors).slice(0, 400), 'fx', profile.currency2, vr[0].json.fx && vr[0].json.fx[profile.currency2]);
  const batches = await run('Make Batches', [{ json: { content: fs.readFileSync(path.join(__dirname, '..', profile.cvFile), 'utf8') } }]);
  console.log('batches', batches.length, 'prompt chars', batches[0].json.jobsText && batches[0].json.jobsText.length);
  const byCountry = {}, bySource = {};
  for (const { json: j } of det) { byCountry[j.country] = (byCountry[j.country] || 0) + 1; for (const s of j.source.split(' + ')) bySource[s] = (bySource[s] || 0) + 1; }
  console.log('by country', byCountry, '\nby source', bySource);
  console.log('skipped', det.filter((i) => i.json.skipReason).map((i) => `${i.json.skipReason}: ${i.json.title} @ ${i.json.company}`));
  for (const { json: j } of det.slice(0, 60)) console.log(`${j.group} | ${j.country} | ${j.title} | ${j.company} | ${j.posted} | ${j.source} | desc ${j.description.length}${j.moreLinks ? ' | +links' : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
