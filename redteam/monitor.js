// Blue-team collectors for the Sentinel console: real, read-only data about the running job finder.
// Sources: n8n's own database (runs, credentials' dates, live workflows), the log files, Windows Task Scheduler,
// the list of listening network ports and the firewall, and git. Secret values are never read: from the credentials
// table only name, type and dates are selected.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.homedir(), '.n8n', 'database.sqlite');
// everyone with a profile in finder/profiles (alphabetical): adding a person needs no change here
const PROFILES = fs.readdirSync(path.join(ROOT, 'finder', 'profiles')).filter((f) => /^[a-z]+\.js$/.test(f)).map((f) => f.slice(0, -3))
  .sort((a, b) => a.localeCompare(b));
const profile = (id) => require(path.join(ROOT, 'finder', 'profiles', id + '.js'));
const TASKS = Object.fromEntries(PROFILES.map((p) => [p, `${profile(p).host.names.label} Daily Job Email`]));
const PRECHECK = 'SentinelPreCheck';
const SENSITIVE_PORTS = { 5678: 'n8n editor (holds Google/Gmail/Gemini logins)', 7777: 'Sentinel console', 11434: 'Ollama local AI', 5679: 'n8n task runner' };
for (let p = 5693; p <= 5699; p++) SENSITIVE_PORTS[p] = 'n8n task runner (CLI run)';

// --- n8n database (read-only) ---
let sqlite;
function db() {
  if (!sqlite) { process.removeAllListeners('warning'); sqlite = require('node:sqlite'); }
  return new sqlite.DatabaseSync(DB_FILE, { readOnly: true });
}
// n8n stores run data in "flatted" form: an array where object fields point at other entries by index
function unflat(text) {
  const arr = JSON.parse(text);
  const done = new Map();
  const resolve = (i) => {
    const v = arr[i];
    if (typeof v !== 'object' || v === null) return v;
    if (done.has(i)) return done.get(i);
    const out = Array.isArray(v) ? [] : {};
    done.set(i, out);
    for (const k of Object.keys(v)) out[k] = typeof v[k] === 'string' ? resolve(Number(v[k])) : v[k];
    return out;
  };
  return resolve(0);
}
const items = (runData, node) => (runData[node] || []).flatMap((r) => ((r.data && r.data.main) || []).flat()).filter(Boolean).map((i) => i.json || {});
// a@example.com -> a***@example.com (the console shows who got it without printing the full address)
const mask = (e) => { const m = String(e || '').match(/^([^@]{1,2})[^@]*(@.+)$/); return m ? m[1] + '***' + m[2] : ''; };
const utc = (s) => new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z'));

// workflow id -> { profile, role, label }
function workflowMap() {
  const map = {};
  for (const p of PROFILES) {
    const { ids, names } = profile(p).host;
    for (const [role, id] of Object.entries(ids)) map[id] = { profile: p, role, label: `${names.label}: ${role}` };
  }
  map[PRECHECK] = { profile: 'both', role: 'precheck', label: 'Google login pre-check' };
  map.JobApp99ErrorLog = { profile: 'both', role: 'errorlog', label: 'Error logger' };
  return map;
}

// one finder run's real numbers, from its stored run data
function finderStats(runData) {
  const combine = items(runData, 'Combine & Filter');
  const summary = combine.find((j) => j._stats) || {};
  const rows = items(runData, 'Build Rows');
  const mail = items(runData, 'Digest Email')[0] || {};
  const count = (n) => (runData[n] || []).reduce((s, r) => s + (((r.data && r.data.main && r.data.main[0]) || []).length), 0);
  const skip = {};
  for (const r of rows) if (r.skipReason) { const k = r.skipReason.replace(/\d+\+ years/, 'N+ years'); skip[k] = (skip[k] || 0) + 1; }
  const errors = Object.entries(runData).flatMap(([n, runs]) => runs.filter((r) => r.error).map((r) => `${n}: ${String(r.error.message || r.error.description || 'error').slice(0, 160)}`));
  return {
    found: summary.total || 0, unique: summary.unique || 0, sources: summary._stats || {},
    scored: rows.filter((r) => r.scored).length, kept: rows.filter((r) => r.keep).length, notScored: rows.filter((r) => !r.scored && !r.skipReason).length,
    // countries of the jobs that went into the email/sheet (checked against the profile's search in findings)
    countries: rows.filter((r) => r.keep).reduce((t, r) => { t[r.country || '?'] = (t[r.country || '?'] || 0) + 1; return t; }, {}),
    best: rows.filter((r) => r.keep).sort((a, b) => b.fit - a.fit).slice(0, 3).map((r) => ({ fit: r.fit, title: r.title, company: r.company, country: r.country })),
    suspicious: rows.filter((r) => r.suspicious).map((r) => ({ title: r.title, company: r.company, link: r.link, fit: r.fit })),
    skip, gemini: { score: count('AI: Score Jobs'), recheck: count('AI: Recheck Top Jobs') },
    emailed: Boolean(runData['Send Digest'] && !runData['Send Digest'].some((r) => r.error)), subject: mail.subject || '', errors,
    // Gmail's own receipt: message id and the SENT label prove the email left the account
    receipt: (() => { const g = items(runData, 'Send Digest')[0]; return g && g.id ? { id: String(g.id), sent: (g.labelIds || []).includes('SENT') } : null; })(),
    to: mask(mail.to),
  };
}

let publicUrl;   // the real link guard from the built workflow code
function linkGuard() {
  if (!publicUrl) {
    const src = fs.readFileSync(path.join(ROOT, 'finder', 'src', 'lib', 'net-guard.js'), 'utf8');
    publicUrl = new Function(src + '\nreturn publicUrl;')();
  }
  return publicUrl;
}

function runs(days = 14) {
  const d = db();
  const map = workflowMap();
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const ids = Object.keys(map);
  const rows = d.prepare(`select e.id, e.workflowId, e.status, e.mode, e.startedAt, e.stoppedAt from execution_entity e
    where e.startedAt >= ? and e.workflowId in (${ids.map(() => '?').join(',')}) order by e.id desc`).all(since, ...ids);
  const getData = d.prepare('select data from execution_data where executionId = ?');
  const out = [];
  for (const r of rows) {
    const meta = map[r.workflowId];
    const start = utc(r.startedAt), stop = r.stoppedAt ? utc(r.stoppedAt) : null;
    const run = { id: r.id, workflowId: r.workflowId, ...meta, status: r.status, mode: r.mode, start: start.toISOString(), seconds: stop ? Math.round((stop - start) / 1000) : null };
    // a "running" run older than 6 hours never finished (the process was killed)
    if (r.status === 'running' && Date.now() - start > 6 * 3600000) run.status = 'abandoned';
    if (['finder', 'test', 'daily', 'weekly'].includes(meta.role)) {
      try {
        const row = getData.get(r.id);
        const data = row && unflat(row.data);
        const runData = (data && data.resultData && data.resultData.runData) || {};
        if (meta.role === 'finder' || meta.role === 'test') run.finder = finderStats(runData);
        if (meta.role === 'weekly') run.gemini = { weekly: (runData['AI: Weekly Insights'] || []).length };
        if (meta.role === 'daily') {
          const sheet = items(runData, 'Get All Jobs');
          const guard = linkGuard();
          run.daily = { rows: sheet.length, expired: items(runData, 'Check Rows').filter((u) => u.Status === 'Expired').length,
            badLinks: sheet.filter((x) => x['Job Link'] && !guard(x['Job Link'])).map((x) => ({ row: x.row_number, link: String(x['Job Link']).slice(0, 120), role: String(x.Role || '').slice(0, 60) })) };
        }
        const err = data && data.resultData && data.resultData.error;
        if (err) run.error = String(err.message || err.description || '').slice(0, 200);
      } catch (e) { run.parseError = e.message; }
    }
    out.push(run);
  }
  d.close();
  return out;
}

function geminiUsage(list) {
  const byDay = {};
  for (const r of list) {
    const day = r.start.slice(0, 10);
    const n = (r.finder ? r.finder.gemini.score + r.finder.gemini.recheck : 0) + ((r.gemini && r.gemini.weekly) || 0);
    if (!n) continue;
    byDay[day] = byDay[day] || { total: 0, ...Object.fromEntries(PROFILES.map((p) => [p, 0])), tests: 0 };
    byDay[day].total += n;
    if (r.role === 'test') byDay[day].tests += n; else if (r.profile in byDay[day]) byDay[day][r.profile] += n;
  }
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10));
  const caps = PROFILES.map((p) => { const s = profile(p).search; return Math.ceil(s.maxJobsToScore / s.jobsPerAiCall) + Math.ceil(s.recheck.maxJobs / s.recheck.jobsPerCall); });
  return { cap: 30, plannedMax: caps.reduce((a, b) => a + b, 0), today: (byDay[days[6]] || { total: 0 }).total, days: days.map((d) => ({ day: d, ...(byDay[d] || { total: 0, ...Object.fromEntries(PROFILES.map((p) => [p, 0])), tests: 0 }) })) };
}

function credentials() {
  const d = db();
  const list = d.prepare('select name, type, updatedAt from credentials_entity order by type').all()
    .map((c) => ({ name: c.name, type: c.type, updated: utc(c.updatedAt).toISOString() }));
  d.close();
  // problems in the n8n log over the last 7 days (the file can be big: read the end only)
  const problems = [];
  const logFile = path.join(ROOT, 'logs', 'n8n.log');
  if (fs.existsSync(logFile)) {
    const size = fs.statSync(logFile).size, len = Math.min(size, 3 * 1024 * 1024);
    const fd = fs.openSync(logFile, 'r'); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const since = Date.now() - 7 * 86400000;
    for (const line of buf.toString('utf8').split('\n')) {
      const m = line.match(/(needs to be reconnected|Access could not be refreshed|invalid_grant|UNAUTHENTICATED|quota|RESOURCE_EXHAUSTED)/i);
      if (!m) continue;
      const ts = (line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/) || [])[0];
      if (ts && new Date(ts) < since) continue;
      problems.push({ at: ts || '', kind: m[1], line: line.replace(/(token|secret|key)["=:\s]+\S+/gi, '$1 [hidden]').slice(0, 220) });
    }
  }
  return { list, problems: problems.slice(-40), google: googleLogins() };
}

// When was each Google login last reconnected? Google ends a Testing-mode login 7 days after it was given, but n8n
// rewrites the credential on every token refresh, so its updatedAt says nothing. The n8n event log records a save in
// the editor ("credentials.updated") but rotates within days: the dates (type + time only) are kept in logs/.
const GOOGLE_TYPES = ['gmailOAuth2', 'googleSheetsOAuth2Api', 'googleDocsOAuth2Api', 'googleDriveOAuth2Api'];
const LOGIN_FILE = path.join(ROOT, 'logs', 'google-logins.json');
function googleLogins() {
  let known = {};
  try { known = JSON.parse(fs.readFileSync(LOGIN_FILE, 'utf8')); } catch { /* first time */ }
  const before = JSON.stringify(known);
  const dir = path.join(os.homedir(), '.n8n');
  for (const f of fs.readdirSync(dir).filter((x) => /^n8nEventLog.*\.log$/.test(x))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.includes('n8n.audit.user.credentials.updated')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const type = e.payload && e.payload.credentialType, at = new Date(e.ts).toISOString();
      if (GOOGLE_TYPES.includes(type) && (!known[type] || known[type] < at)) known[type] = at;
    }
  }
  if (JSON.stringify(known) !== before) fs.writeFileSync(LOGIN_FILE, JSON.stringify(known, null, 1));
  return GOOGLE_TYPES.map((type) => ({ type, reconnected: known[type] || null,
    expires: known[type] ? new Date(Date.parse(known[type]) + 7 * 86400000).toISOString() : null }));
}

function mailLogs() {
  const out = {};
  for (const p of PROFILES) {
    const f = path.join(ROOT, 'logs', `${p}-mail.log`);
    out[p] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(-25) : [];
  }
  return out;
}

// Windows: scheduled tasks, listening ports, firewall (one PowerShell call, ~7 s: run without blocking the console)
async function windows() {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
$tasks = foreach ($n in @(${PROFILES.map((p) => `'${TASKS[p]}'`).join(',')})) { $t = Get-ScheduledTask -TaskName $n; if ($t) { $i = $t | Get-ScheduledTaskInfo
  [pscustomobject]@{ name=$n; state="$($t.State)"; last=$i.LastRunTime.ToUniversalTime().ToString('o'); result=$i.LastTaskResult; next=$i.NextRunTime.ToUniversalTime().ToString('o'); wake=$t.Settings.WakeToRun } } }
$procs = @{}; Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }
$ports = Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ addr=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; proc=$procs[[int]$_.OwningProcess] } }
$fw = Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name=$_.Name; enabled=[bool]$_.Enabled; inbound="$($_.DefaultInboundAction)" } }
$net = Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ name=$_.Name; category="$($_.NetworkCategory)" } }
[pscustomobject]@{ tasks=@($tasks); ports=@($ports); firewall=@($fw); networks=@($net) } | ConvertTo-Json -Depth 4 -Compress`;
  const stdout = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 45000, windowsHide: true, maxBuffer: 16 << 20 }, (e, out) => (out ? resolve(out) : reject(e || new Error('no output')))));
  const data = JSON.parse(stdout || '{}');
  const ports = new Map();
  for (const p of data.ports || []) {
    const scope = /^(127\.|::1$)/.test(p.addr) ? 'local' : 'network';
    const key = p.port + '|' + scope;
    if (!ports.has(key)) ports.set(key, { port: p.port, scope, addr: [p.addr], proc: p.proc || '?', pid: p.pid, what: SENSITIVE_PORTS[p.port] || '' });
    else ports.get(key).addr.push(p.addr);
  }
  const list = [...ports.values()].sort((a, b) => a.port - b.port).map((p) => ({ ...p,
    severity: p.scope === 'network' && p.what ? 'critical' : p.scope === 'network' && p.port < 1024 ? 'info' : p.scope === 'network' ? 'low' : 'ok' }));
  return { tasks: data.tasks || [], ports: list, firewall: data.firewall || [], networks: data.networks || [] };
}

// live workflows in n8n compared with the reviewed build (finder/workflows/<profile>/)
function integrity() {
  const d = db();
  const get = d.prepare('select nodes, updatedAt from workflow_entity where id = ?');
  const out = [];
  const FILES = { setup: 'D0Setup.json', finder: 'D1Finder.json', daily: 'D2Daily.json', weekly: 'D3Weekly.json' };
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
  for (const p of PROFILES) {
    const prof = profile(p);
    let state = {};
    try { state = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', prof.host.stateFile), 'utf8')); } catch { /* not set up */ }
    for (const [role, file] of Object.entries(FILES)) {
      const id = prof.host.ids[role];
      const row = get.get(id);
      if (!row) { out.push({ profile: p, role, id, status: 'missing' }); continue; }
      const live = JSON.parse(row.nodes);
      const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'finder', 'workflows', p, file), 'utf8')).nodes;
      const email = (() => { const c = live.find((n) => n.name === 'Config'); return c ? ((c.parameters.jsCode || '').match(/"digestEmail":\s*"([^"]*)"|digestEmail: '([^']*)'/) || []).slice(1).find(Boolean) : ''; })();
      const norm = (s) => { let t = String(s || ''); for (const [v, ph] of [[state.sheetId, '__SHEET_ID__'], [state.docId, '__MASTER_RESUME_DOC_ID__'], [email, '__DIGEST_EMAIL__']]) if (v) t = t.split(v).join(ph); return t; };
      const body = (n) => (n.parameters.jsCode !== undefined ? n.parameters.jsCode : n.parameters.text !== undefined ? n.parameters.text : null);
      const changed = [], checked = [];
      for (const b of built.filter((n) => body(n) !== null)) {
        const l = live.find((n) => n.name === b.name);
        checked.push(b.name);
        if (!l) changed.push(`${b.name} (missing)`);
        else if (hash(norm(body(l))) !== hash(body(b))) changed.push(b.name);
      }
      out.push({ profile: p, role, id, status: changed.length ? 'changed' : 'ok', checked: checked.length, changed, updated: utc(row.updatedAt).toISOString() });
    }
  }
  d.close();
  return out;
}

const SECRET_PATTERNS = [[/AIza[0-9A-Za-z_-]{35}/, 'Google API key'], [/ya29\.[0-9A-Za-z_-]{20,}/, 'Google access token'], [/\b1\/\/0[0-9A-Za-z_-]{30,}/, 'Google refresh token'],
  [/GOCSPX-[0-9A-Za-z_-]{20,}/, 'Google client secret'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/\bsk-(ant-)?[A-Za-z0-9_-]{32,}/, 'API secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token']];
const FAKE = /fake|abcdefghij|abcdef$|SecretValue|example|xxxxxxxx/i;
function repo() {
  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
  const files = git('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean);
  const leaks = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|ico|pdf|zip|xlsx|docx|pptx|woff2?|ttf|exe|dll|pyc|sqlite)$/i.test(f)) continue;
    let text; try { const st = fs.statSync(path.join(ROOT, f)); if (st.size > 4 * 1024 * 1024) continue; text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const [rx, what] of SECRET_PATTERNS) for (const m of text.matchAll(new RegExp(rx.source, 'g'))) if (!FAKE.test(m[0])) leaks.push({ file: f, what });
  }
  // the fictional sample CVs in finder/examples/ are meant to be public
  const privateFiles = PROFILES.flatMap((p) => [`finder/${profile(p).cvFile}`, `tools/${profile(p).host.stateFile}`]).filter((f) => !f.startsWith('finder/examples/'));
  const notIgnored = privateFiles.filter((f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: ROOT }).status !== 0);
  const status = git('status', '--porcelain').split('\n').filter(Boolean);
  const last = git('log', '-1', '--format=%h|%cI|%s').trim().split('|');
  const unpushed = git('rev-list', '--count', '@{u}..HEAD').trim();
  return { scanned: files.length, leaks, notIgnored, uncommitted: status.length, lastCommit: { hash: last[0], at: last[1], subject: last[2] }, unpushed: unpushed === '' ? null : Number(unpushed) };
}

// what an attacker would see: is n8n reachable from the network, does it answer without a login?
async function probes() {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const tryGet = async (url) => {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'manual' }); return { url, reachable: true, status: r.status }; }
    catch (e) { return { url, reachable: false, error: String((e.cause && e.cause.code) || e.name) }; }
  };
  const fromNetwork = await Promise.all(lan.map((ip) => tryGet(`http://${ip}:5678/healthz`)));
  const local = await tryGet('http://127.0.0.1:5678/healthz');
  const api = await tryGet('http://127.0.0.1:5678/rest/workflows');   // must ask for a login
  return { lan, fromNetwork, local, apiNeedsLogin: api.reachable ? [401, 403].includes(api.status) : null, apiStatus: api.status || api.error };
}

// Did every workflow run properly today, and did each person really get today's email?
// The Windows task starts at the profile's time and retries hourly for 6 hours; Sunday adds the weekly summary.
const RETRY_HOURS = 6;
const localDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
function delivery(list, mail) {
  const now = new Date(), today = localDay(now);
  const out = {};
  for (const p of PROFILES) {
    const prof = profile(p);
    const [hh, mm] = prof.host.names.time.split(':').map(Number);
    const due = new Date(now); due.setHours(hh, mm, 0, 0);
    const giveUp = new Date(due.getTime() + RETRY_HOURS * 3600000);
    const mine = list.filter((r) => r.profile === p || r.workflowId === PRECHECK);
    const todays = (role) => mine.filter((r) => r.role === role && localDay(r.start) === today);
    const finder = todays('finder');
    const sent = finder.find((r) => r.status === 'success' && r.finder && r.finder.emailed);
    // mail log lines (the Windows task's own record) for today
    const log = ((mail || {})[p] || []).filter((l) => l.startsWith(today));
    const failedTries = log.filter((l) => /FAILED/.test(l)).length;
    // a person just added: the Windows task has never run (no run in n8n, no line in the task log) -> not a missed email
    const isNew = !list.some((r) => r.profile === p && r.role === 'finder') && !((mail || {})[p] || []).length;
    let state, detail;
    if (isNew) { state = 'scheduled'; detail = `new: first email ${now < due ? 'today' : 'tomorrow'} at ${prof.host.names.time}`; }
    else if (sent) {
      const rc = sent.finder.receipt;
      state = 'sent';
      detail = `${new Date(sent.start).toTimeString().slice(0, 5)} · "${sent.finder.subject}" · to ${sent.finder.to || '?'}${rc ? ` · Gmail id ${rc.id.slice(0, 8)}… ${rc.sent ? 'SENT label ✔' : 'no SENT label'}` : ' · no Gmail receipt'}`;
    } else if (log.some((l) => /Email sent/.test(l))) {
      state = 'sent'; detail = `${log.filter((l) => /Email sent/.test(l)).pop().slice(11)} (from the task log)`;
    } else if (now < due) { state = 'scheduled'; detail = `due at ${prof.host.names.time}`; }
    else if (now < giveUp) { state = 'retrying'; detail = `${failedTries} failed attempt(s) so far, retries until ${giveUp.toTimeString().slice(0, 5)}`; }
    else { state = 'missed'; detail = `no email today; ${failedTries} failed attempt(s) in the task log`; }
    const last = (role) => { const r = mine.find((x) => x.role === role); return r ? { status: r.status, start: r.start, seconds: r.seconds, error: r.error || '', today: localDay(r.start) === today } : null; };
    const isSunday = now.getDay() === 0;
    // days before this profile's first daily run in the data are "not live yet", not missed emails
    const firstRun = list.filter((r) => r.profile === p && r.role === 'finder').map((r) => localDay(r.start)).sort()[0] || (isNew ? localDay(Date.now() + 86400000) : today);
    out[p] = {
      isNew, state, detail, due: due.toISOString(), giveUp: giveUp.toISOString(), attemptsToday: log.filter((l) => /Run started/.test(l)).length,
      workflows: [
        { role: 'precheck', name: 'Google login pre-check', expect: 'every run, before anything else', ...last('precheck') },
        { role: 'daily', name: 'Sheet check (expired jobs, follow-ups)', expect: 'daily, before the email', ...last('daily') },
        { role: 'finder', name: 'Job search + email', expect: `daily ${prof.host.names.time}`, ...last('finder') },
        { role: 'weekly', name: 'Weekly summary email', expect: isSunday ? 'today (Sunday), after the daily email' : 'Sundays', ...last('weekly') },
      ],
      week: Array.from({ length: 7 }, (_, i) => { const d = localDay(Date.now() - (6 - i) * 86400000); const ok = list.some((r) => r.profile === p && r.role === 'finder' && localDay(r.start) === d && r.status === 'success' && r.finder && r.finder.emailed) || ((mail || {})[p] || []).some((l) => l.startsWith(d) && /Email sent/.test(l)); return { day: d, sent: ok, live: d >= firstRun }; }),
    };
  }
  return out;
}

// everything, plus findings with a severity and the source each one comes from
// The page never waits: it gets the last result at once and a refresh starts in the background when that is older
// than 8 s. The slow checks (Windows ~7 s, network probes ~2 s) refresh every 60 s on their own and are not awaited.
let cache = { at: 0, data: null }, refreshing = null;
const slow = { at: 0, running: false, win: null, repo: null, probes: null, errors: {} };
function refreshSlow() {
  if (slow.running || Date.now() - slow.at < 60000) return null;
  slow.running = true;
  const errors = {};
  const job = slow.job = Promise.all([
    windows().catch((e) => { errors.windows = e.message; return null; }),
    probes().catch((e) => { errors.probes = e.message; return null; }),
    Promise.resolve().then(repo).catch((e) => { errors.repo = e.message; return null; }),
  ]).then(([win, pr, rp]) => {
    Object.assign(slow, { at: Date.now(), win: win || slow.win, probes: pr || slow.probes, repo: rp || slow.repo, errors });
    cache.at = 0;   // the next page poll rebuilds with the new results
  }).finally(() => { slow.running = false; });
  return job;
}
async function collect() {
  refreshSlow();   // right after the console starts the page opens at once; Windows/network panels say "checking" for ~10 s
  if (cache.data && Date.now() - cache.at < 8000) return cache.data;
  if (!cache.data) return build();
  if (!refreshing) refreshing = Promise.resolve().then(build).catch(() => null).finally(() => { refreshing = null; });
  return cache.data;
}
function build() {
  const errors = { ...slow.errors };
  const safe = (name, fn) => { try { return fn(); } catch (e) { errors[name] = e.message; return null; } };
  const list = safe('runs', () => runs(14)) || [];
  const data = {
    at: new Date().toISOString(), host: os.hostname(),
    people: PROFILES.map((p) => ({ id: p, label: profile(p).host.names.label, where: profile(p).host.names.where || '', time: profile(p).host.names.time })),
    runs: list, gemini: geminiUsage(list), creds: safe('credentials', credentials), mail: safe('mail', mailLogs),
    win: slow.win, integrity: safe('integrity', integrity), repo: slow.repo, probes: slow.probes, checking: !slow.at,
    redteam: safe('redteam', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'report.json'), 'utf8'))),
    errors,
  };
  data.delivery = safe('delivery', () => delivery(list, data.mail)) || {};
  data.findings = findings(data);
  const sev = data.findings.map((f) => f.severity);
  data.threat = sev.includes('critical') ? 'critical' : sev.includes('high') ? 'high' : sev.includes('medium') ? 'elevated' : 'secure';
  cache = { at: Date.now(), data };
  return data;
}

function findings(d) {
  const f = [];
  const add = (severity, area, title, detail, source) => f.push({ severity, area, title, detail, source });
  for (const p of PROFILES) {
    const dl = (d.delivery || {})[p];
    if (dl && dl.state === 'missed') add('high', 'delivery', `${p}: today's email was NOT sent`, dl.detail, 'n8n database + task log');
    if (dl && dl.state === 'retrying') add('medium', 'delivery', `${p}: today's email not sent yet (retrying)`, dl.detail, 'task log');
    for (const w of (dl ? dl.workflows : [])) if (w.status && !['success', 'abandoned'].includes(w.status) && w.today) add('medium', 'delivery', `${p}: ${w.name} ${w.status} today`, w.error || '', 'n8n database');
    const last = d.runs.find((r) => r.profile === p && r.role === 'finder');
    if (!last) { if (!(dl && dl.isNew)) add('medium', 'missions', `${p}: no daily run in 14 days`, '', 'n8n database'); }
    else if (!['success'].includes(last.status)) add('high', 'missions', `${p}: last daily run ${last.status}`, last.error || '', 'n8n database');
    else if (Date.now() - new Date(last.start) > 30 * 3600000) add('medium', 'missions', `${p}: last daily run is over 30 h old`, last.start, 'n8n database');
    else if (last.finder && !last.finder.emailed) add('high', 'missions', `${p}: last run sent no email`, '', 'n8n database');
    // the email may only hold jobs in the person's countries (plus remote ones where the profile allows them)
    const lastOk = d.runs.find((r) => r.profile === p && r.role === 'finder' && r.status === 'success' && r.finder);
    if (lastOk) {
      const s = profile(p).search;
      const off = Object.entries(lastOk.finder.countries || {}).filter(([c]) => !s.countries.includes(c) && !(s.remote && /remote/i.test(c)));
      if (off.length) add('medium', 'missions', `${p}: ${off.reduce((n, [, k]) => n + k, 0)} job(s) outside ${s.countries.join('/')} in the last email`, off.map(([c, k]) => `${c} ${k}`).join(', ') + ` (run ${lastOk.start.slice(0, 16).replace('T', ' ')} UTC)`, 'n8n run data (Build Rows)');
    }
    const daily = d.runs.find((r) => r.profile === p && r.role === 'daily' && r.daily);
    if (daily && daily.daily.badLinks.length) add('high', 'sheet', `${p}: ${daily.daily.badLinks.length} link(s) in the sheet point at internal/non-web addresses`, daily.daily.badLinks.map((b) => `row ${b.row}: ${b.link}`).join(' · '), 'n8n database (daily check input)');
  }
  const susp = d.runs.filter((r) => r.finder && r.role === 'finder').flatMap((r) => r.finder.suspicious.map((s) => ({ ...s, profile: r.profile })));
  if (susp.length) add('low', 'ads', `${susp.length} job ad(s) contained text aimed at the AI (cut out, score capped)`, susp.slice(0, 5).map((s) => `${s.title} @ ${s.company}`).join(' · '), 'n8n database');
  const today = d.gemini.days[d.gemini.days.length - 1];
  if (today.total - today.tests > d.gemini.cap) add('high', 'gemini', `Gemini calls today ${today.total - today.tests} > cap ${d.gemini.cap} (daily runs)`, '', 'n8n database');
  else if (today.total > d.gemini.cap) add('low', 'gemini', `Gemini calls today ${today.total} incl. ${today.tests} from test runs`, 'daily runs alone are within the cap', 'n8n database');
  // a login error only counts while it is newer than the last reconnect of the Google logins
  if (d.creds) {
    const google = d.creds.list.filter((c) => /^(gmail|google(Sheets|Docs|Drive))/.test(c.type));
    const reconnected = google.length ? Math.min(...google.map((c) => new Date(c.updated).getTime())) : 0;
    for (const x of d.creds.problems) x.resolved = Boolean(x.at) && new Date(x.at).getTime() < reconnected;
    const open = d.creds.problems.filter((x) => !x.resolved && Date.now() - new Date(x.at || 0) < 86400000);
    if (open.length) add('high', 'logins', `${open.length} Google login error(s) since the last reconnect`, open.slice(-1)[0].line, 'logs/n8n.log');
  }
  if (d.win) {
    for (const p of d.win.ports.filter((x) => x.severity === 'critical')) add('critical', 'network', `${p.what} is reachable from the network (port ${p.port})`, `bound to ${p.addr.join(', ')} by ${p.proc}`, 'Windows TCP table');
    for (const fw of d.win.firewall.filter((x) => !x.enabled)) add('high', 'network', `Windows firewall off for the ${fw.name} profile`, '', 'Windows firewall');
    // 267009 = running, 267011 = not run yet; a failed attempt is resolved when that profile's email was sent after it
    for (const p of PROFILES) {
      const t = d.win.tasks.find((x) => x.name === TASKS[p]);
      if (!t || [0, 267009, 267011].includes(t.result)) continue;
      const sent = (d.mail && d.mail[p] || []).filter((l) => /Email sent/.test(l)).map((l) => new Date(l.slice(0, 19).replace(' ', 'T'))).pop();
      t.resolved = Boolean(sent && sent >= new Date(t.last));
      if (!t.resolved) add('medium', 'missions', `Task "${t.name}" failed (result ${t.result})`, `last run ${t.last}`, 'Task Scheduler + mail log');
    }
    for (const p of PROFILES) if (!d.win.tasks.some((t) => t.name === TASKS[p])) add('high', 'missions', `Task "${TASKS[p]}" is missing`, '', 'Task Scheduler');
  }
  if (d.probes && d.probes.fromNetwork.some((x) => x.reachable)) add('critical', 'network', 'n8n answers on the Wi-Fi address', d.probes.fromNetwork.filter((x) => x.reachable).map((x) => x.url).join(' '), 'live probe');
  if (d.probes && d.probes.apiNeedsLogin === false) add('critical', 'network', 'n8n API answers without a login', String(d.probes.apiStatus), 'live probe');
  for (const w of (d.integrity || []).filter((x) => x.status !== 'ok')) add(w.status === 'missing' ? 'medium' : 'high', 'integrity', `${w.profile} ${w.role} workflow ${w.status === 'missing' ? 'not found in n8n' : 'differs from the reviewed build'}`, (w.changed || []).join(', '), 'n8n database vs finder/workflows');
  if (d.repo) {
    if (d.repo.leaks.length) add('critical', 'secrets', `${d.repo.leaks.length} possible secret(s) in files git can see`, d.repo.leaks.map((l) => `${l.what} in ${l.file}`).join(' · '), 'repo scan');
    if (d.repo.notIgnored.length) add('high', 'privacy', 'private files not ignored by git', d.repo.notIgnored.join(', '), 'git');
  }
  if (d.redteam && d.redteam.failed) add('high', 'red team', `${d.redteam.failed} red-team test(s) breached`, d.redteam.report.filter((r) => !r.pass).map((r) => r.id).join(', '), 'redteam/out/report.json');
  if (d.redteam && Date.now() - new Date(d.redteam.at) > 7 * 86400000) add('low', 'red team', 'red-team suite not run for 7+ days', d.redteam.at, 'redteam/out/report.json');
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}

module.exports = { collect, runs, integrity, windows, probes, repo, credentials, googleLogins, unflat, db, items, localDay, linkGuard, profile, PROFILES };
