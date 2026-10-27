// Runs one person's job search (finder/profiles/<profile>.js) on this laptop and emails them the new jobs every morning.
// First run creates "<Name> Job Finder" in Drive: a sheet that remembers which jobs were sent and a doc with the CV for the AI.
// Then builds finder/workflows/<profile>/ and imports them into n8n under the profile's own workflow ids, with this laptop's
// Google and Gemini logins. The Windows task (tools/<profile>-daily.ps1) runs them each morning.
// Usage: node tools/host.js --profile=alex --to=email@example.com
//        node tools/host.js --profile=maria --to=you@example.com --test [--max=12]   (test copy: writes nothing to the sheet, emails --to only)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const PROFILE_ID = arg('profile');
const FINDER = path.join(__dirname, '..', 'finder');
if (!/^[a-z]+$/.test(PROFILE_ID) || !fs.existsSync(path.join(FINDER, 'profiles', PROFILE_ID + '.js'))) {
  console.error('Usage: node tools/host.js --profile=alex|maria --to=email@example.com [--test [--max=12]]'); process.exit(1);
}
const P = require(path.join(FINDER, 'profiles', PROFILE_ID + '.js'));
const { ids: IDS, names: N } = P.host;
const STATE_FILE = path.join(__dirname, P.host.stateFile);   // Drive ids only
const to = arg('to');
if (!/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(to)) { console.error('Usage: node tools/host.js --profile=... --to=email@example.com'); process.exit(1); }
const TEST = process.argv.includes('--test');

const env = { ...process.env, N8N_RUNNERS_BROKER_PORT: String(P.host.brokerPort), N8N_RUNNERS_TASK_TIMEOUT: '900' };
const n8n = (args) => {
  const r = spawnSync(['n8n', ...args].join(' '), { env, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const lastJson = (t) => JSON.parse(t.slice(t.indexOf('\n{') + 1, t.lastIndexOf('}') + 1));
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

function importWorkflow(wf) {
  const file = path.join(os.tmpdir(), `host-${PROFILE_ID}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify([wf]));
  try { const r = n8n(['import:workflow', `--input="${file}"`]); if (r.code) throw new Error(r.out.slice(-800)); } finally { fs.unlinkSync(file); }
}
function execute(id) {
  const r = n8n(['execute', `--id=${id}`, '--rawOutput']);
  if (r.code) throw new Error(`workflow ${id} failed:\n${r.out.slice(-1500)}`);
  return lastJson(r.out).data.resultData.runData;
}
const manual = () => ({ id: crypto.randomUUID(), name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} });

// this laptop's n8n credentials by type (encrypted export, read for ids and names only, deleted right away)
const creds = {};
{
  const tmp = path.join(os.tmpdir(), `host-${PROFILE_ID}-creds-${Date.now()}.json`);
  try {
    n8n(['export:credentials', '--all', `--output="${tmp}"`]);
    for (const c of JSON.parse(fs.readFileSync(tmp, 'utf8'))) creds[c.type] = creds[c.type] || { id: c.id, name: c.name };
  } finally { fs.rmSync(tmp, { force: true }); }
  const missing = ['googlePalmApi', 'googleSheetsOAuth2Api', 'googleDocsOAuth2Api', 'googleDriveOAuth2Api', 'gmailOAuth2'].filter((t) => !creds[t]);
  if (missing.length) throw new Error('Missing n8n credentials: ' + missing.join(', '));
}
const credFor = (node) => ({
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': 'googlePalmApi', 'n8n-nodes-base.googleSheets': 'googleSheetsOAuth2Api',
  'n8n-nodes-base.googleDocs': 'googleDocsOAuth2Api', 'n8n-nodes-base.googleDrive': 'googleDriveOAuth2Api', 'n8n-nodes-base.gmail': 'gmailOAuth2',
}[node.type] || node.parameters.nodeCredentialType);

// 1) Drive files (first run only)
if (!state.sheetId) {
  const cv = fs.readFileSync(path.join(FINDER, P.cvFile), 'utf8').trim();
  if (cv.length < 200) throw new Error(`${P.cvFile} is empty`);
  const http = (name, x, method, url, type, jsonBody) => ({
    id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x, 0], executeOnce: true,
    credentials: { [type]: creds[type] },
    parameters: { method, url, authentication: 'predefinedCredentialType', nodeCredentialType: type, options: {},
      ...(jsonBody ? { sendBody: true, specifyBody: 'json', jsonBody } : {}) } });
  const FOLDER = 'application/vnd.google-apps.folder';
  const nodes = [
    manual(),
    { id: crypto.randomUUID(), name: 'CV Text', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: `return [{ json: { cv: ${JSON.stringify(cv)} } }];` } },
    http('Create Folder', 400, 'POST', 'https://www.googleapis.com/drive/v3/files', 'googleDriveOAuth2Api', JSON.stringify({ name: N.folder, mimeType: FOLDER })),
    http('Create CV Doc', 600, 'POST', 'https://www.googleapis.com/drive/v3/files', 'googleDriveOAuth2Api',
      `={{ JSON.stringify({ name: ${JSON.stringify(N.cvDoc)}, mimeType: 'application/vnd.google-apps.document', parents: [$('Create Folder').first().json.id] }) }}`),
    http('Insert CV Text', 800, 'POST', "=https://docs.googleapis.com/v1/documents/{{ $('Create CV Doc').first().json.id }}:batchUpdate", 'googleDocsOAuth2Api',
      "={{ JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: $('CV Text').first().json.cv } }] }) }}"),
    http('Create Sheet', 1000, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', 'googleSheetsOAuth2Api',
      JSON.stringify({ properties: { title: N.sheet }, sheets: ['Jobs', 'Weekly', 'Seen', 'Errors'].map((t) => ({ properties: { title: t } })) })),
    http('Drive Root', 1200, 'GET', 'https://www.googleapis.com/drive/v3/files/root?fields=id', 'googleDriveOAuth2Api'),
    http('Move Sheet', 1400, 'PATCH',
      "=https://www.googleapis.com/drive/v3/files/{{ $('Create Sheet').first().json.spreadsheetId }}?addParents={{ $('Create Folder').first().json.id }}&removeParents={{ $('Drive Root').first().json.id }}",
      'googleDriveOAuth2Api', '{}'),
  ];
  const connections = {};
  nodes.slice(0, -1).forEach((n, i) => { connections[n.name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] }; });
  importWorkflow({ id: IDS.files, name: `${N.label}: create Drive files (setup)`, active: false, nodes, connections, settings: { executionOrder: 'v1' } });
  const run = execute(IDS.files);
  const out = (n) => run[n][run[n].length - 1].data.main[0][0].json;
  Object.assign(state, { folderId: out('Create Folder').id, docId: out('Create CV Doc').id, sheetId: out('Create Sheet').spreadsheetId });
  save();
  console.log(`Created in Drive: folder "${N.folder}", sheet ${state.sheetId}, CV doc ${state.docId}`);
}

// 2) Workflows built from the profile, with this laptop's logins
const build = spawnSync(process.execPath, [path.join(FINDER, 'build-workflows.js'), `--profile=${PROFILE_ID}`], { encoding: 'utf8' });
if (build.status) throw new Error('build-workflows.js failed: ' + build.stderr);
const prepare = (file, id, name) => {
  const text = fs.readFileSync(path.join(FINDER, 'workflows', PROFILE_ID, file), 'utf8')
    .split('__SHEET_ID__').join(state.sheetId).split('__MASTER_RESUME_DOC_ID__').join(state.docId).split('__DIGEST_EMAIL__').join(to);
  const wf = JSON.parse(text);
  if (/__[A-Z_]+__/.test(JSON.stringify(wf))) throw new Error(`unfilled placeholder in ${file}`);
  Object.assign(wf, { id, name, active: false });
  delete wf.settings.errorWorkflow;   // the Windows task logs failures and shows a popup
  for (const node of wf.nodes) { const t = credFor(node); if (t && creds[t]) node.credentials = { [t]: creds[t] }; }
  return wf;
};
// the Windows task starts every workflow, so their own schedules are removed
const noSchedule = (wf) => {
  wf.nodes = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.scheduleTrigger');
  for (const k of Object.keys(wf.connections)) if (!wf.nodes.some((n) => n.name === k)) delete wf.connections[k];
  return wf;
};

// --test: imports a separate test copy of the finder (live workflows untouched) that writes nothing to the sheet,
// treats every job as new, scores at most --max jobs and emails only --to; then runs it once and prints a summary.
if (TEST) {
  const max = Number(arg('max') || 12);
  const t = noSchedule(prepare('D1Finder.json', IDS.test, `ZZ ${N.label} finder TEST (Claude)`));
  t.nodes = t.nodes.filter((n) => !['Jobs Rows', 'Add to Jobs Sheet', 'Seen Rows', 'Add to Seen'].includes(n.name));
  for (const k of Object.keys(t.connections)) if (!t.nodes.some((n) => n.name === k)) delete t.connections[k];
  t.connections['Build Rows'] = { main: [[{ node: 'Digest Email', type: 'main', index: 0 }]] };
  for (const n of t.nodes.filter((x) => ['Get Jobs Already Logged', 'Get Seen Jobs'].includes(x.name))) {
    Object.assign(n, { type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return [{ json: {} }];' } });   // every job counts as new
    delete n.credentials;
  }
  const cfg = t.nodes.find((n) => n.name === 'Config').parameters;
  cfg.jsCode = cfg.jsCode.replace(/"maxJobsToScore": \d+/, `"maxJobsToScore": ${max}`);
  t.nodes.find((n) => n.name === 'Build Rows').alwaysOutputData = true;
  const mail = t.nodes.find((n) => n.name === 'Digest Email').parameters;
  mail.jsCode = mail.jsCode.split('subject = `').join(`subject = \`TEST ${N.label} - `);
  t.nodes.find((n) => n.name === 'Send Digest').parameters.options.senderName = N.sender;
  importWorkflow(t);
  console.log(`Imported test copy ${IDS.test} (max ${max} jobs), running it...`);
  const started = Date.now();
  const run = execute(IDS.test);
  const last = (n) => (run[n] ? run[n][run[n].length - 1].data.main.flat().map((i) => i.json) : null);
  console.log(`Done in ${((Date.now() - started) / 60000).toFixed(1)} min.`);
  const calls = ['AI: Score Jobs', 'AI: Recheck Top Jobs'].map((n) => (run[n] ? run[n].reduce((s, r) => s + ((r.data && r.data.main && r.data.main[0]) || []).length, 0) : 0));
  console.log(`Gemini calls: ${calls[0]} scoring + ${calls[1]} recheck`);
  const gr = (last('Gemini Results') || [])[0];
  if (gr) console.log(`Gemini: ${gr.results.length} jobs scored`);
  const rows = last('Build Rows') || [];
  console.log(`Rows: ${rows.length}, scored ${rows.filter((r) => r.scored).length}`);
  for (const r of rows) console.log(`  ${String(r.fit).padStart(3)} ${String(r.verdict).padEnd(8)} ${r.scored ? '' : 'NOT SCORED '}${String(r.country).padEnd(11)} ${String(r.title).slice(0, 50)} @ ${String(r.company).slice(0, 22)}${r.flags && r.flags.length ? '  [' + r.flags.join('; ') + ']' : ''}`);
  console.log(`Email: ${run['Send Digest'] ? 'sent to ' + to : 'NOT sent'}`);
  process.exit(0);
}

importWorkflow(prepare('D0Setup.json', IDS.setup, `${N.label}: format job sheet (setup)`));
// read-only Google login test that tools/daily.ps1 runs before every job search (shared by everyone: any sheet and doc will do)
{
  const pre = JSON.parse(fs.readFileSync(path.join(__dirname, 'precheck.json'), 'utf8').split('__SHEET_ID__').join(state.sheetId).split('__MASTER_RESUME_DOC_ID__').join(state.docId));
  for (const node of pre.nodes) { const t = credFor(node); if (t && creds[t]) node.credentials = { [t]: creds[t] }; }
  importWorkflow(pre);
}
// daily sheet check (no AI): Applied On, follow-up after 7 days, dead links -> Expired. Started by the Windows task before the search.
importWorkflow(noSchedule(prepare('D2Daily.json', IDS.daily, `${N.label}: daily sheet check (runs from Windows task ${N.time})`)));
// weekly summary (stats, skills asked, gaps, what to learn), started by the Windows task on Sundays after the daily email
importWorkflow(noSchedule(prepare('D3Weekly.json', IDS.weekly, `${N.label}: weekly summary (runs from Windows task on Sundays)`)));
const finder = noSchedule(prepare('D1Finder.json', IDS.finder, `${N.label}: daily job email (runs from Windows task ${N.time})`));
finder.nodes.find((n) => n.name === 'Build Rows').alwaysOutputData = true;   // empty day -> still reaches the email
finder.nodes.find((n) => n.name === 'Send Digest').parameters.options.senderName = N.sender;
importWorkflow(finder);
console.log(`Imported "${finder.name}" (${IDS.finder}), email to ${to}`);

// setup runs again when the engine's sheet layout changes (adds missing tabs such as Weekly, headers, widths); it is safe to repeat
const SETUP_VERSION = 3;   // 3: Status..Notes first (existing columns moved with their data), new look
if (state.setupVersion !== SETUP_VERSION) {
  execute(IDS.setup);
  state.setupVersion = SETUP_VERSION; delete state.formatted; save();
  console.log('Sheet formatted.');
}

// the sheet is their tracker: they may edit it (Google sends no email; the link is in every job email)
if (P.host.shareSheet && state.sharedWith !== to) {
  const share = { id: crypto.randomUUID(), name: 'Share Sheet', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [200, 0],
    credentials: { googleDriveOAuth2Api: creds.googleDriveOAuth2Api },
    parameters: { method: 'POST', url: `https://www.googleapis.com/drive/v3/files/${state.sheetId}/permissions?sendNotificationEmail=false`,
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api', sendBody: true, specifyBody: 'json',
      jsonBody: JSON.stringify({ role: 'writer', type: 'user', emailAddress: to }), options: {} } };
  importWorkflow({ id: IDS.share, name: `${N.label}: share job sheet (setup)`, active: false, settings: { executionOrder: 'v1' },
    nodes: [manual(), share], connections: { Start: { main: [[{ node: 'Share Sheet', type: 'main', index: 0 }]] } } });
  execute(IDS.share);
  state.sharedWith = to; save();
  console.log(`Sheet shared with ${to} (can edit).`);
}
console.log(`Sheet: https://docs.google.com/spreadsheets/d/${state.sheetId}/edit`);
