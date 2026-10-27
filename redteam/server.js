// Live red-team console: node redteam/server.js, then open http://127.0.0.1:7777
// Streams every step of the red-team suite (engine.js) to the browser as it happens (Server-Sent Events).
// It can also start a real n8n test run of one profile (tools/host.js --test), which emails the TEST list to the address typed in.
// Only reachable from this laptop: listens on 127.0.0.1, and refuses requests whose Host header is not this address
// (stops a web page from reaching it through DNS rebinding); actions need a POST with the X-Redteam header (stops cross-site posts).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runAll } = require('./engine');
const monitor = require('./monitor');
const career = require('./career');
let careerFor = null, careerData = null;

const PORT = Number(process.env.REDTEAM_PORT) || 7777;
// --demo: shows redteam/demo/status.json (fictional people and jobs) instead of this laptop's data; buttons are switched off
const DEMO = process.argv.includes('--demo');
const clients = new Set();
let history = [];           // events of the current/last run, replayed to a page that connects later
let busy = '';
if (DEMO) history = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo', 'events.json'), 'utf8'));   // a recorded red-team run

function emit(e) {
  const ev = { ...e, t: Date.now() };
  history.push(ev);
  if (history.length > 20000) history = history.slice(-20000);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
}

function startSuite(only) {
  if (busy) return false;
  busy = 'suite'; history = [];
  emit({ type: 'boot', what: 'suite' });
  runAll(emit, { only, pace: 350 }).catch((e) => emit({ type: 'log', id: '-', line: 'ERROR ' + e.message })).finally(() => { busy = ''; emit({ type: 'idle' }); });
  return true;
}

// a real n8n run of the test copy: the live workflows and the sheet are not touched; Gemini is used (max jobs => few calls)
function startLive(profile, to, max) {
  if (busy) return false;
  busy = 'live'; history = [];
  emit({ type: 'boot', what: 'live', profile, max });
  const args = [path.join(__dirname, '..', 'tools', 'host.js'), `--profile=${profile}`, `--to=${to}`, '--test', `--max=${max}`];
  emit({ type: 'live', stream: 'cmd', line: `$ node tools/host.js --profile=${profile} --to=${to} --test --max=${max}` });
  const child = spawn(process.execPath, args, { cwd: path.join(__dirname, '..') });
  const pipe = (stream, name) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) if (line.trim()) emit({ type: 'live', stream: name, line: line.slice(0, 400) });
    });
  };
  pipe(child.stdout, 'out'); pipe(child.stderr, 'err');
  const tick = setInterval(() => emit({ type: 'live', stream: 'tick' }), 5000);
  child.on('close', (code) => { clearInterval(tick); emit({ type: 'liveDone', code }); busy = ''; emit({ type: 'idle' }); });
  return true;
}

// "Sync sheet": runs the profile's normal daily sheet check now (fills in Applied On, flags follow-ups, marks dead links
// Expired), so statuses typed into the sheet today show up in Career HQ. No AI calls, no email. Its output holds sheet
// rows, so only the start, the end and a short error go to the feed.
const SYNC_PORT = '5699';   // own n8n task-runner port (host.js uses 5695/5697, the daily tasks 5696/5698)
function startSync(profile) {
  if (busy) return false;
  busy = 'sync';
  const id = require(path.join(__dirname, '..', 'finder', 'profiles', profile + '.js')).host.ids.daily;
  emit({ type: 'sync', profile, state: 'running' });
  emit({ type: 'live', stream: 'cmd', line: `$ n8n execute --id=${id}   (${profile}: daily sheet check, no AI, no email)` });
  const child = spawn(`n8n execute --id=${id}`, { cwd: path.join(__dirname, '..'), shell: true, windowsHide: true,
    env: { ...process.env, N8N_RUNNERS_BROKER_PORT: SYNC_PORT, N8N_RUNNERS_TASK_TIMEOUT: '900' } });
  let tail = '';
  const keep = (d) => { tail = (tail + d).slice(-4000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const tick = setInterval(() => emit({ type: 'live', stream: 'tick' }), 5000);
  child.on('close', (code) => {
    clearInterval(tick);
    const why = code ? (tail.match(/(Error|error)[^\n]{0,200}/) || [''])[0] : '';
    emit({ type: 'sync', profile, state: code ? 'failed' : 'done', error: why });
    emit({ type: 'liveDone', code });
    busy = ''; emit({ type: 'idle' });
  });
  return true;
}

const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 4096) req.destroy(); }); req.on('end', () => resolve(b)); });

function start(port = PORT, onReady) {
// each server has its own allowed Host list: the red-team suite starts a second one in this process (G14)
let HOST_OK = new Set();
const server = http.createServer(async (req, res) => {
  if (!HOST_OK.has(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:" });
    return fs.createReadStream(path.join(__dirname, 'dashboard.html')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/status' && DEMO) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo', 'status.json'), 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(JSON.stringify({ ...d, busy: '', checking: false, ui: fs.statSync(path.join(__dirname, 'dashboard.html')).mtimeMs }));
  }
  if (req.method === 'POST' && DEMO) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, demo: true })); }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    try {
      const d = await monitor.collect();
      // career numbers change only when the monitor data does: work them out once per refresh
      if (careerFor !== d) {
        try { careerData = career.collect(d); } catch (e) { careerData = { profiles: {}, project: null, errors: { career: e.message } }; }
        careerFor = d;
      }
      const c = careerData;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); // ui = the page file's change time: an open page reloads itself when the console was updated
      const ui = fs.statSync(path.join(__dirname, 'dashboard.html')).mtimeMs;
      return res.end(JSON.stringify({ ...d, career: c, busy, ui }));
    }
    catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', busy, replay: history.length })}\n\n`);
    for (const ev of history) res.write(`data: ${JSON.stringify({ ...ev, replay: true })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (req.method === 'POST' && req.headers['x-redteam'] === '1') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* empty */ }
    let ok = false;
    if (url.pathname === '/run') ok = startSuite(Array.isArray(body.only) ? body.only.filter((x) => /^[BG]\d\d$/.test(x)) : null);
    if (url.pathname === '/live') {
      const profile = monitor.PROFILES.includes(body.profile) ? body.profile : '';
      const to = /^[^\s@"'<>&|;`$()]+@[^\s@"'<>&|;`$()]+\.[a-z]{2,}$/i.test(body.to || '') ? body.to : '';
      const max = Math.max(1, Math.min(20, Number(body.max) || 10));
      if (!profile || !to) { res.writeHead(400); return res.end('profile and email needed'); }
      ok = startLive(profile, to, max);
    }
    if (url.pathname === '/sync') {
      if (!monitor.PROFILES.includes(body.profile)) { res.writeHead(400); return res.end('profile needed'); }
      ok = startSync(body.profile);
    }
    res.writeHead(ok ? 202 : 409, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok, busy }));
  }
  res.writeHead(404); res.end();
});
server.listen(port, '127.0.0.1', () => {
  const bound = server.address().port;
  HOST_OK = new Set([`127.0.0.1:${bound}`, `localhost:${bound}`]);
  if (onReady) onReady(server, bound);
});
return server;
}

module.exports = { start };
if (require.main === module) start(PORT, (s, port) => {
  console.log(`Sentinel console: http://127.0.0.1:${port}${DEMO ? '  DEMO DATA (fictional)' : ''}  (Ctrl+C to stop)`);
  if (DEMO) return;
  monitor.collect().catch(() => {});   // warm up: the slow Windows check runs now, not when the page first opens
  if (process.argv.includes('--run')) startSuite(null);
});
