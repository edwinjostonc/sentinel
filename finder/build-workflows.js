// Builds workflows/<profile>/D0-D3 for one person's job finder from src/, prompts/ and profiles/<profile>.js.
// Usage: node finder/build-workflows.js --profile=alex|maria   (tools/host.js runs this and imports the result)
// Placeholders (__SHEET_ID__ etc.) are filled in by tools/host.js.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const SRC = path.join(HERE, 'src');
const PROFILE_ID = (process.argv.find((a) => a.startsWith('--profile=')) || '--profile=alex').slice(10);
if (!/^[a-z]+$/.test(PROFILE_ID) || !fs.existsSync(path.join(HERE, 'profiles', PROFILE_ID + '.js'))) { console.error(`No profile "${PROFILE_ID}" in finder/profiles/`); process.exit(1); }
const PROFILE = require(path.join(HERE, 'profiles', PROFILE_ID + '.js'));
const OUT = path.join(HERE, 'workflows', PROFILE_ID);
fs.mkdirSync(OUT, { recursive: true });
const MODEL = 'models/gemini-3.1-flash-lite', FALLBACK = 'models/gemini-3.5-flash-lite';
// second check of the best jobs (src/recheck-queue.js): stronger Flash model, Flash-Lite as fallback
const RECHECK_MODEL = 'models/gemini-3.5-flash', RECHECK_FALLBACK = 'models/gemini-3.5-flash-lite';

const SALARY2_HEADER = `Salary (${PROFILE.currency2}/yr)`;
// what people use every day comes first (Status .. Notes), the details after; the setup moves existing sheets into this order
const JOBS_HEADERS = ['Status', 'Fit Score', 'Verdict', 'Role', 'Company', 'Country', 'Location', 'Work Mode', 'Job Link', 'Applied On', 'Follow-up', 'Notes',
  'Date Found', 'Posted', 'Why It Fits', 'Gaps', 'Visa / Sponsor', 'Language', 'Salary', 'Salary (EUR/yr)', SALARY2_HEADER, 'Resume Changes', 'More Links', 'Source'];
const SEEN_HEADERS = ['Job Link', 'Date', 'Fit Score', 'Note', 'Key'];
const ERROR_HEADERS = ['Date', 'Workflow', 'Node', 'Error Message'];
const WEEKLY_HEADERS = ['Week', 'Jobs Found', 'Strong (75+)', 'Applied (total)', 'Interviews (total)', 'By Country', 'Top Skills Asked', 'Your Top Gaps', 'Learn Next', 'Best Companies'];

const code = (file) => {
  let js = fs.readFileSync(path.join(SRC, file), 'utf8');
  js = js.replace(/^\/\/@include (.+)$/gm, (m, f) => fs.readFileSync(path.join(SRC, f.trim()), 'utf8').trim());
  return js.replace(/JOBS_HEADERS/g, JSON.stringify(JOBS_HEADERS)).replace(/WEEKLY_HEADERS/g, JSON.stringify(WEEKLY_HEADERS))
    .replace(/\bSALARY2_HEADER\b/g, JSON.stringify(SALARY2_HEADER));
};
// the profile's search settings become the Config node (plus the second salary currency)
const configCode = () => `// Search settings for ${PROFILE_ID}, generated from finder/profiles/${PROFILE_ID}.js. Edit the profile, not this node.\n`
  + `return [{ json: ${JSON.stringify({ ...PROFILE.search, currency2: PROFILE.currency2 }, null, 2)} }];`;
// v2 job scoring answer (prompts/job_score_v2.md). Field order matters: the AI writes its reasoning before the numbers.
const V2_SCHEMA = (() => {
  const str = { type: 'string' };
  const int = (max) => ({ type: 'integer', minimum: 0, maximum: max });
  const properties = { id: str, requirements: str, evidence: str, blocker_quote: str,
    blockers: { type: 'array', items: { type: 'string', enum: ['language', 'location', 'eligibility', 'seniority', 'profession'] } },
    skills: int(40), experience: int(25), domain: int(15), must_haves: int(20),
    why: str, gaps: str, resume_changes: str, visa_note: str, language_note: str };
  return { type: 'object', required: ['results'], properties: { results: { type: 'array', items: { type: 'object', required: Object.keys(properties), properties } } } };
})();
const PROMPT_FIELDS = { ROLE: 'role', LANGUAGE_RULE: 'languageRule', DOMAIN_HINT: 'domainHint', LANGUAGE_NOTE_EXAMPLE: 'languageNoteExample', COACH: 'coach' };
const prompt = (file) => '=' + fs.readFileSync(path.join(HERE, 'prompts', file), 'utf8').trim()
  .replace(/%%([A-Z_]+)%%/g, (m, k) => { const v = PROFILE.prompt[PROMPT_FIELDS[k]]; if (typeof v !== 'string') throw new Error(`profile.prompt has no ${k}`); return v; });
const uid = (wf, name) => { const h = crypto.createHash('md5').update(wf + '/' + name).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

function workflow(id, name) {
  const nodes = [], connections = {};
  const wf = { id, name, active: false, nodes, connections, settings: { executionOrder: 'v1', timezone: PROFILE.timezone, errorWorkflow: 'JobApp99ErrorLog' } };
  wf.add = (n, x, y, type, typeVersion, parameters, extra = {}) => { nodes.push({ parameters, id: uid(id, n), name: n, type, typeVersion, position: [x, y], ...extra }); return n; };
  wf.code = (n, x, y, file, extra) => wf.add(n, x, y, 'n8n-nodes-base.code', 2, { jsCode: code(file) }, extra);
  wf.link = (from, to, out = 0, type = 'main', index = 0) => {
    connections[from] = connections[from] || {};
    const list = (connections[from][type] = connections[from][type] || []);
    while (list.length <= out) list.push([]);
    list[out].push({ node: to, type, index });
  };
  wf.chain = (...names) => names.slice(1).forEach((n, i) => wf.link(names[i], n));
  return wf;
}
const sheetsRead = (wf, n, x, y, tab) => wf.add(n, x, y, 'n8n-nodes-base.googleSheets', 4.7,
  { documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' }, sheetName: { __rl: true, mode: 'name', value: tab }, options: {} },
  { executeOnce: true, alwaysOutputData: true });
const schema = (cols, extra = []) => [...extra, ...cols.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }))];
const sheetsAppend = (wf, n, x, y, tab, cols) => wf.add(n, x, y, 'n8n-nodes-base.googleSheets', 4.7, {
  operation: 'append', documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' }, sheetName: { __rl: true, mode: 'name', value: tab },
  columns: { mappingMode: 'defineBelow', value: Object.fromEntries(cols.map((c) => [c, `={{ $json[${JSON.stringify(c)}] }}`])), matchingColumns: [], schema: schema(cols),
    attemptToConvertTypes: false, convertFieldsToString: false },
  options: { cellFormat: 'RAW' } });
const gmail = (wf, n, x, y) => wf.add(n, x, y, 'n8n-nodes-base.gmail', 2.1,
  { sendTo: '={{ $json.to }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false } });
const gemini = (wf, n, x, y, model) => wf.add(n, x, y, '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1.1, { modelName: model, options: { temperature: 0.1 } });
const parser = (wf, n, x, y, jsonSchema) => wf.add(n, x, y, '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, { schemaType: 'manual', inputSchema: JSON.stringify(jsonSchema, null, 2) });
function aiChain(wf, n, x, y, text, jsonSchema, model = MODEL, fallback = FALLBACK) {
  wf.add(n, x, y, '@n8n/n8n-nodes-langchain.chainLlm', 1.9, { promptType: 'define', text, hasOutputParser: true, needsFallback: true, batching: { batchSize: 1, delayBetweenBatches: 4000 } },
    { retryOnFail: true, maxTries: 4, waitBetweenTries: 5000, onError: 'continueRegularOutput' });
  wf.link(gemini(wf, `Gemini (${n.replace('AI: ', '')})`, x - 60, y + 220, model), n, 0, 'ai_languageModel', 0);
  wf.link(gemini(wf, `Gemini Fallback (${n.replace('AI: ', '')})`, x + 80, y + 220, fallback), n, 0, 'ai_languageModel', 1);
  wf.link(parser(wf, `Parser: ${n.replace('AI: ', '')}`, x + 220, y + 220, jsonSchema), n, 0, 'ai_outputParser', 0);
  return n;
}
const write = (wf, file) => { delete wf.add; delete wf.code; delete wf.link; delete wf.chain; fs.writeFileSync(path.join(OUT, file), JSON.stringify(wf, null, 2)); return wf; };

// D0: sheet setup, run once by the wizard
{
  const wf = workflow('SentinelD0Setup0', 'D0 Setup Sheet (run once)');
  const api = (n, x, method, url, body) => wf.add(n, x, 300, 'n8n-nodes-base.httpRequest', 4.2, { method, url, authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api', ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}), options: {} });
  wf.add('Run Once (Manual)', 0, 300, 'n8n-nodes-base.manualTrigger', 1, {});
  api('Read Sheet', 200, 'GET', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__?fields=sheets.properties');
  wf.add('Tabs To Add', 400, 300, 'n8n-nodes-base.code', 2, { jsCode: `// batchUpdate needs at least one request, so rename the first tab to itself if nothing is missing
const s = $input.first().json.sheets || [];
const have = s.map((x) => x.properties.title);
const requests = ${JSON.stringify(['Jobs', 'Seen', 'Errors', 'Weekly'])}.filter((t) => !have.includes(t)).map((title) => ({ addSheet: { properties: { title } } }));
return [{ json: { body: { requests: requests.length ? requests : [{ updateSheetProperties: { properties: { sheetId: s[0].properties.sheetId, title: s[0].properties.title }, fields: 'title' } }] } } }];` });
  api('Add Tabs', 600, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__:batchUpdate', '={{ JSON.stringify($json.body) }}');
  // an existing Jobs tab may still have an older column order: move whole columns (data included) before the headers are written
  api('Read Headers', 700, 'GET', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__/values/Jobs!1:1');
  wf.code('Column Moves', 750, 300, 'd0-moves.js');
  api('Move Columns', 800, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__:batchUpdate', '={{ JSON.stringify($json.body) }}');
  api('Write Headers', 900, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__/values:batchUpdate', JSON.stringify({ valueInputOption: 'RAW', data: [
    { range: 'Jobs!A1', values: [JOBS_HEADERS] }, { range: 'Seen!A1', values: [SEEN_HEADERS] }, { range: 'Errors!A1', values: [ERROR_HEADERS] }, { range: 'Weekly!A1', values: [WEEKLY_HEADERS] }] }));
  api('Read Sheet Again', 1000, 'GET', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__?fields=sheets(properties,conditionalFormats,bandedRanges)');
  wf.code('Format Requests', 1200, 300, 'd0-format.js');
  api('Apply Formatting', 1400, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets/__SHEET_ID__:batchUpdate', '={{ JSON.stringify($json.body) }}');
  wf.chain('Run Once (Manual)', 'Read Sheet', 'Tabs To Add', 'Add Tabs', 'Read Headers', 'Column Moves', 'Move Columns', 'Write Headers', 'Read Sheet Again', 'Format Requests', 'Apply Formatting');
  write(wf, "D0Setup.json");
}

// D1: job finder
{
  const wf = workflow('SentinelD1Finder', 'D1 Job Finder (09:00 + 17:00)');
  wf.add('Twice a Day', 0, 300, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [
    { field: 'days', daysInterval: 1, triggerAtHour: 9, triggerAtMinute: 0 }, { field: 'days', daysInterval: 1, triggerAtHour: 17, triggerAtMinute: 0 }] } });
  wf.add('Run Now (Manual)', 0, 500, 'n8n-nodes-base.manualTrigger', 1, {});
  wf.add('Config', 200, 300, 'n8n-nodes-base.code', 2, { jsCode: configCode() });
  wf.code('Fetch Job Boards', 400, 300, 'fetch-boards.js', { onError: 'continueRegularOutput' });
  wf.code('Adzuna Requests', 600, 300, 'adzuna-requests.js', { executeOnce: true });
  wf.add('Adzuna Search', 800, 300, 'n8n-nodes-base.httpRequest', 4.2, { url: '={{ $json.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
    options: { timeout: 30000, batching: { batch: { batchSize: 1, batchInterval: 1500 } }, response: { response: { neverError: true } } } },
    { onError: 'continueRegularOutput', alwaysOutputData: true });
  wf.code('Fetch LinkedIn', 1000, 300, 'fetch-linkedin.js', { executeOnce: true, onError: 'continueRegularOutput' });
  wf.code('Combine & Filter', 1200, 300, 'combine.js', { executeOnce: true });
  sheetsRead(wf, 'Get Jobs Already Logged', 1400, 300, 'Jobs');
  sheetsRead(wf, 'Get Seen Jobs', 1600, 300, 'Seen');
  wf.code('New Jobs Only', 1800, 300, 'new-jobs.js', { executeOnce: true });
  wf.code('Get Job Details', 2000, 300, 'details.js');
  wf.code('Visa & Rates', 2200, 300, 'visa-rates.js');
  wf.add('Get Master Resume', 2400, 300, 'n8n-nodes-base.googleDocs', 2, { operation: 'get', documentURL: '__MASTER_RESUME_DOC_ID__', simple: true }, { executeOnce: true });
  wf.code('Make Batches', 2600, 300, 'make-batches.js');
  wf.add('Anything to Score?', 2800, 300, 'n8n-nodes-base.if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid('D1', 'cond'), leftValue: '={{ $json.nothingToScore }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    looseTypeValidation: true, options: {} });
  // Gemini only (no local AI), one call per batch of jobs
  aiChain(wf, 'AI: Score Jobs', 4000, 200, prompt('job_score_v2.md'), V2_SCHEMA);
  wf.code('Gemini Results', 4200, 200, 'gemini-results.js');
  wf.code('Recheck Queue', 4400, 200, 'recheck-queue.js');
  wf.add('Recheck Needed?', 4600, 200, 'n8n-nodes-base.if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid('D1', 'recheck'), leftValue: '={{ $json.nothing }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    looseTypeValidation: true, options: {} });
  aiChain(wf, 'AI: Recheck Top Jobs', 4800, 100, prompt('job_score_v2.md'), V2_SCHEMA, RECHECK_MODEL, RECHECK_FALLBACK);
  wf.code('Recheck Results', 5000, 100, 'recheck-results.js');
  wf.code('Build Rows', 5200, 400, 'build-rows.js', { executeOnce: true });
  wf.code('Jobs Rows', 3500, 160, 'jobs-rows.js');
  sheetsAppend(wf, 'Add to Jobs Sheet', 3700, 160, 'Jobs', JOBS_HEADERS);
  wf.code('Seen Rows', 3500, 340, 'seen-rows.js');
  sheetsAppend(wf, 'Add to Seen', 3700, 340, 'Seen', SEEN_HEADERS);
  wf.code('Digest Email', 3500, 520, 'email.js');
  gmail(wf, 'Send Digest', 3700, 520);
  wf.chain('Twice a Day', 'Config');
  wf.chain('Run Now (Manual)', 'Config');
  wf.chain('Config', 'Fetch Job Boards', 'Adzuna Requests', 'Adzuna Search', 'Fetch LinkedIn', 'Combine & Filter', 'Get Jobs Already Logged', 'Get Seen Jobs',
    'New Jobs Only', 'Get Job Details', 'Visa & Rates', 'Get Master Resume', 'Make Batches', 'Anything to Score?');
  wf.link('Anything to Score?', 'Build Rows', 0);   // true branch = nothing to score
  wf.link('Anything to Score?', 'AI: Score Jobs', 1);
  wf.chain('AI: Score Jobs', 'Gemini Results', 'Recheck Queue', 'Recheck Needed?');
  wf.link('Recheck Needed?', 'Build Rows', 0);   // true branch = no job good enough to recheck
  wf.link('Recheck Needed?', 'AI: Recheck Top Jobs', 1);
  wf.chain('AI: Recheck Top Jobs', 'Recheck Results', 'Build Rows');
  wf.link('Build Rows', 'Jobs Rows'); wf.link('Build Rows', 'Seen Rows'); wf.link('Build Rows', 'Digest Email');
  wf.chain('Jobs Rows', 'Add to Jobs Sheet'); wf.chain('Seen Rows', 'Add to Seen'); wf.chain('Digest Email', 'Send Digest');
  write(wf, "D1Finder.json");
}

// D2: daily sheet check
{
  const wf = workflow('SentinelD2Daily0', 'D2 Daily Check (expired jobs, follow-ups)');
  wf.add('Every Morning', 0, 300, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 8, triggerAtMinute: 30 }] } });
  wf.add('Run Now (Manual)', 0, 500, 'n8n-nodes-base.manualTrigger', 1, {});
  sheetsRead(wf, 'Get All Jobs', 250, 300, 'Jobs');
  wf.code('Check Rows', 500, 300, 'f2-check-rows.js');
  const cols = ['Status', 'Applied On', 'Follow-up'];
  wf.add('Update Rows', 750, 300, 'n8n-nodes-base.googleSheets', 4.7, { operation: 'update', documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__' },
    sheetName: { __rl: true, mode: 'name', value: 'Jobs' },
    columns: { mappingMode: 'defineBelow', value: { row_number: '={{ $json.row_number }}', ...Object.fromEntries(cols.map((c) => [c, `={{ $json[${JSON.stringify(c)}] }}`])) },
      matchingColumns: ['row_number'], schema: schema(cols, [{ id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true, removed: false }]),
      attemptToConvertTypes: false, convertFieldsToString: false }, options: { cellFormat: 'RAW' } });
  wf.chain('Every Morning', 'Get All Jobs'); wf.chain('Run Now (Manual)', 'Get All Jobs'); wf.chain('Get All Jobs', 'Check Rows', 'Update Rows');
  write(wf, "D2Daily.json");
}

// D3: weekly summary
{
  const wf = workflow('SentinelD3Weekly', 'D3 Weekly Summary (Sunday 18:00)');
  wf.add('Every Sunday', 0, 300, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [0], triggerAtHour: 18, triggerAtMinute: 0 }] } });
  wf.add('Run Now (Manual)', 0, 500, 'n8n-nodes-base.manualTrigger', 1, {});
  wf.add('Config', 200, 300, 'n8n-nodes-base.code', 2, { jsCode: "return [{ json: { digestEmail: '__DIGEST_EMAIL__' } }];" });
  sheetsRead(wf, 'Get All Jobs', 400, 300, 'Jobs');
  wf.code('Weekly Numbers', 600, 300, 'f3-stats.js');   // no executeOnce, it needs every row
  wf.add('Get Master Resume', 800, 300, 'n8n-nodes-base.googleDocs', 2, { operation: 'get', documentURL: '__MASTER_RESUME_DOC_ID__', simple: true }, { executeOnce: true });
  wf.add('Any Jobs This Week?', 1000, 300, 'n8n-nodes-base.if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid('D3', 'cond'), leftValue: "={{ $('Weekly Numbers').first().json.nothing }}", rightValue: '', operator: { type: 'boolean', operation: 'false', singleValue: true } }], combinator: 'and' },
    looseTypeValidation: true, options: {} });
  aiChain(wf, 'AI: Weekly Insights', 1250, 200, prompt('weekly_insights.md'), { type: 'object', required: ['top_skills', 'top_gaps', 'learn_next', 'advice'],
    properties: { top_skills: { type: 'array', items: { type: 'string' } }, top_gaps: { type: 'array', items: { type: 'string' } },
      learn_next: { type: 'array', items: { type: 'string' } }, advice: { type: 'string' } } });
  wf.code('Build Summary', 1550, 300, 'f3-build.js', { executeOnce: true });
  wf.add('Weekly Row', 1750, 200, 'n8n-nodes-base.code', 2, { jsCode: 'return [{ json: $input.first().json.row }];' });
  sheetsAppend(wf, 'Add to Weekly', 1950, 200, 'Weekly', WEEKLY_HEADERS);
  wf.add('Has Email?', 1750, 420, 'n8n-nodes-base.filter', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid('D3', 'mail'), leftValue: '={{ $json.to }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }], combinator: 'and' },
    looseTypeValidation: true, options: {} });
  gmail(wf, 'Email Summary', 1950, 420);
  wf.chain('Every Sunday', 'Config'); wf.chain('Run Now (Manual)', 'Config');
  wf.chain('Config', 'Get All Jobs', 'Weekly Numbers', 'Get Master Resume', 'Any Jobs This Week?');
  wf.link('Any Jobs This Week?', 'AI: Weekly Insights', 0); wf.link('Any Jobs This Week?', 'Build Summary', 1);
  wf.chain('AI: Weekly Insights', 'Build Summary');
  wf.link('Build Summary', 'Weekly Row'); wf.link('Build Summary', 'Has Email?');
  wf.chain('Weekly Row', 'Add to Weekly'); wf.chain('Has Email?', 'Email Summary');
  write(wf, "D3Weekly.json");
}

// sanity checks
const { execFileSync } = require('child_process');
let bad = 0;
for (const f of fs.readdirSync(OUT).filter((x) => /^D\d.*\.json$/.test(x))) {
  const wf = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const names = new Set(wf.nodes.map((n) => n.name));
  if (/%%[A-Z_]+%%|\bSALARY2_HEADER\b|\/\/@include/.test(JSON.stringify(wf))) { console.error(`${f}: unfilled build placeholder`); bad++; }
  for (const [from, c] of Object.entries(wf.connections)) for (const outs of Object.values(c)) for (const o of outs) for (const t of o)
    if (!names.has(from) || !names.has(t.node)) { console.error(`${f}: broken connection ${from} -> ${t.node}`); bad++; }
  for (const n of wf.nodes.filter((x) => x.parameters.jsCode)) {
    // executeOnce only passes the first item, so $input.all() would silently see one row
    if (n.executeOnce && n.parameters.jsCode.includes('$input.all()')) { console.error(`${f} / ${n.name}: executeOnce + $input.all() sees only 1 item`); bad++; }
    const tmp = path.join(require('os').tmpdir(), `chk-${process.pid}.js`);
    fs.writeFileSync(tmp, `(async function () {\n${n.parameters.jsCode}\n})`);
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); } catch (e) { console.error(`${f} / ${n.name}: ${String(e.stderr).split('\n').slice(0, 5).join('\n')}`); bad++; }
    fs.unlinkSync(tmp);
  }
  console.log(`built ${f}: ${wf.nodes.length} nodes`);
}
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
