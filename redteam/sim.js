// Runs Code nodes from the BUILT workflows (finder/workflows/<profile>/*.json) outside n8n, the same way n8n would:
// $('Node') reads earlier results, $input is the incoming items, this.helpers.httpRequest is a fake web that records
// every request. Nothing here talks to Google, Gemini or the real job sites.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const luxon = (() => { try { return require(path.join(process.env.APPDATA || '', 'npm/node_modules/n8n/node_modules/luxon')); } catch { return require('luxon'); } })();

function load(profile, file = 'D1Finder.json') {
  // fresh copy each time: tests may edit node code or config
  return JSON.parse(require('fs').readFileSync(path.join(ROOT, 'finder', 'workflows', profile, file), 'utf8'));
}

// fake web: routes = [[test(url, opts) => bool, (url, opts) => response | throws]]; unmatched requests answer 404
function fakeWeb(routes = []) {
  const calls = [];
  async function httpRequest(o) {
    const u = new URL(o.url);
    for (const [k, v] of Object.entries(o.qs || {})) u.searchParams.set(k, v);
    const url = u.toString();
    calls.push({ url, method: o.method || 'GET', followRedirect: !o.disableFollowRedirect });
    const route = routes.find(([test]) => test(url, o));
    let res = route ? await route[1](url, o) : { statusCode: 404, body: 'not found' };
    if (typeof res !== 'object' || res === null || !('statusCode' in res)) res = { statusCode: 200, body: res };
    // n8n follows redirects itself unless told not to
    let hops = 0;
    while (!o.disableFollowRedirect && res.statusCode >= 300 && res.statusCode < 400 && res.headers && res.headers.location && hops++ < 5) {
      const next = res.headers.location;
      calls.push({ url: next, method: 'GET', followRedirect: true, viaRedirect: true });
      const r2 = routes.find(([test]) => test(next, o));
      res = r2 ? await r2[1](next, o) : { statusCode: 404, body: 'not found' };
      if (typeof res !== 'object' || !('statusCode' in res)) res = { statusCode: 200, body: res };
    }
    if (!o.ignoreHttpStatusErrors && res.statusCode >= 400) throw new Error(`Request failed with status code ${res.statusCode}`);
    let body = res.body;
    if (o.json && typeof body === 'string') { try { body = JSON.parse(body); } catch { /* n8n hands back the text */ } }
    return o.returnFullResponse ? { statusCode: res.statusCode, body, headers: res.headers || {} } : body;
  }
  return { httpRequest, calls };
}

// one run context: results by node name, like n8n's run data
function context(wf, web = fakeWeb()) {
  const results = {};
  const node = (name) => {
    const n = wf.nodes.find((x) => x.name === name);
    if (!n) throw new Error(`no node "${name}" in ${wf.name}`);
    return n;
  };
  async function run(name, input = [], opts = {}) {
    const js = opts.code || node(name).parameters.jsCode;
    const $ = (n) => {
      if (!(n in results)) throw new Error(`node ${n} has not run`);
      const items = results[n];
      return { all: () => items, first: () => items[0], item: items[0] };
    };
    const $input = { all: () => input, first: () => input[0] };
    const now = opts.now ? luxon.DateTime.fromISO(opts.now) : luxon.DateTime.now();
    const fn = new Function('$', '$input', '$now', 'DateTime', `return (async function () {\n${js}\n}).call(this);`);
    const out = await fn.call({ helpers: { httpRequest: web.httpRequest } }, $, $input, now, luxon.DateTime);
    results[name] = out || [];
    return results[name];
  }
  const set = (name, jsons) => { results[name] = jsons.map((json) => ({ json })); return results[name]; };
  const config = async (patch = {}) => {
    const out = await run('Config');
    Object.assign(out[0].json, { digestEmail: 'redteam@example.invalid' }, patch);
    return out[0].json;
  };
  return { wf, web, results, node, run, set, config };
}

// a plausible job as it leaves a job board, before job()/accept()
let seq = 0;
const fakeJob = (over = {}) => ({
  source: 'Careerjet', id: 'RT-' + (++seq), title: 'Sustainability Analyst', company: 'Acme Green BV', location: 'Amsterdam, Netherlands',
  country: 'Netherlands', workMode: '', link: `https://www.example.com/jobs/${seq}`, posted: new Date().toISOString().slice(0, 10),
  description: 'We are looking for a sustainability analyst to support our CSRD reporting and carbon accounting. You will work with the team on ESG data. English is our working language.',
  salary: null, group: 'A', key: 'acme|sustainabilityanalyst|netherlands-' + seq, links: [`https://www.example.com/jobs/${seq}`], moreLinks: '', skipReason: '', ...over,
});

module.exports = { load, fakeWeb, context, fakeJob, luxon, ROOT };
