// Career HQ collectors for the Sentinel console: the job hunt itself (what to apply to today, the pipeline, streaks,
// the job market, skill gaps) and the health of this project. Read-only, real data only:
// - the job sheet as n8n last read it (daily sheet check or job search run data in n8n's database; no new Google access)
// - the weekly summary's AI insights (top skills asked, top gaps, what to learn next)
// - git history and PROGRESS_LOG.md "IDEAS FOR LATER" for the project roadmap
// Statuses are typed by hand in the sheet (To apply / Applied / Interview / Offer / Rejected / Not for me / Expired);
// the daily sheet check fills in "Applied On", so "Sync sheet" in the console runs that check to pick up today's changes.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const m = require('./monitor');

const ROOT = path.join(__dirname, '..');
const DAILY_GOAL = 3;       // applications per day
const WEEKLY_GOAL = 15;     // applications per week (Mon-Sun)
const STAGES = ['To apply', 'Applied', 'Interview', 'Offer', 'Rejected', 'Not for me', 'Expired'];
const SENT = ['Applied', 'Interview', 'Offer', 'Rejected'];   // statuses that mean an application went out

// free, official or well-known learning pages for skills that show up in job gaps
const COURSES = [
  [/\bsql\b/i, 'SQL', 'https://sqlbolt.com/'],
  [/python/i, 'Python', 'https://www.freecodecamp.org/learn/scientific-computing-with-python/'],
  [/power ?bi|\bdax\b/i, 'Power BI', 'https://learn.microsoft.com/en-us/training/powerplatform/power-bi'],
  [/tableau/i, 'Tableau', 'https://www.tableau.com/learn/training'],
  [/\bexcel\b/i, 'Excel', 'https://support.microsoft.com/en-us/training'],
  [/azure/i, 'Azure', 'https://learn.microsoft.com/en-us/training/azure/'],
  [/\baws\b/i, 'AWS', 'https://skillbuilder.aws/'],
  [/servicenow/i, 'ServiceNow', 'https://nowlearning.servicenow.com/'],
  [/\bitil\b/i, 'ITIL', 'https://www.axelos.com/certifications/itil-service-management'],
  [/hl7|fhir/i, 'HL7 / FHIR', 'https://www.hl7.org/fhir/overview.html'],
  [/a\/b test/i, 'A/B testing', 'https://www.udacity.com/course/ab-testing--ud257'],
  [/statistic/i, 'Statistics', 'https://www.khanacademy.org/math/statistics-probability'],
  [/\bgit\b/i, 'Git', 'https://learngitbranching.js.org/'],
  [/german|deutsch/i, 'German', 'https://learngerman.dw.com/en/overview'],
  [/dutch/i, 'Dutch', 'https://www.ou.nl/en/web/introduction-to-dutch'],
  [/swedish/i, 'Swedish', 'https://www.svenska.se/'],
  [/\besg\b|sustainab/i, 'ESG / sustainability', 'https://www.edx.org/learn/sustainability'],
  [/\bsap\b/i, 'SAP', 'https://learning.sap.com/'],
  [/linux/i, 'Linux', 'https://linuxjourney.com/'],
  [/active directory|intune|microsoft 365|m365/i, 'Microsoft 365 admin', 'https://learn.microsoft.com/en-us/training/m365/'],
  [/network (admin|engineer)|\btcp\/ip\b|\bccna\b/i, 'Networking', 'https://www.netacad.com/'],
];
const courseFor = (text) => { const c = COURSES.find(([re]) => re.test(text)); return c ? { skill: c[1], url: c[2] } : null; };

// 2026-10-04, 04/10/2026, 4.10.2026 (day first) or a Sheets serial number -> 'YYYY-MM-DD'
function day(v) {
  const s = String(v || '').trim();
  let x;
  if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`;
  if ((x = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) return `${x[3].length === 2 ? '20' + x[3] : x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  return '';
}
const dayOffset = (n) => m.localDay(Date.now() - n * 86400000);
// Monday of the week a day falls in
const weekOf = (d) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return m.localDay(x); };

// the job sheet as n8n last read it: the newest of the daily sheet check and the job search (which also adds rows)
function sheet(p, list) {
  const db = m.db();
  try {
    const get = db.prepare('select data from execution_data where executionId = ?');
    const read = (run) => { const row = get.get(run.id); return row ? ((m.unflat(row.data).resultData || {}).runData || {}) : {}; };
    const daily = list.find((r) => r.profile === p && r.role === 'daily' && r.status === 'success');
    const finder = list.find((r) => r.profile === p && r.role === 'finder' && r.status === 'success');
    const newest = [daily, finder].filter(Boolean).sort((a, b) => b.start.localeCompare(a.start))[0];
    if (!newest) return null;
    const rd = read(newest);
    let rows;
    if (newest === daily) {
      rows = m.items(rd, 'Get All Jobs');
      // the check's own edits (Applied On filled in, follow-ups due, expired links) are written after the read
      const upd = new Map(m.items(rd, 'Check Rows').map((u) => [String(u.row_number), u]));
      rows = rows.map((r) => ({ ...r, ...(upd.get(String(r.row_number)) || {}) }));
    } else rows = [...m.items(rd, 'Get Jobs Already Logged'), ...m.items(rd, 'Add to Jobs Sheet')];
    rows = rows.filter((r) => r && (r.Role || r.Company));
    return { at: newest.start, from: newest === daily ? 'sheet check' : 'job search', rows };
  } finally { db.close(); }
}

function forProfile(p, d) {
  const snap = sheet(p, d.runs);
  const guard = m.linkGuard();
  const today = m.localDay(new Date());
  const rows = snap ? snap.rows : [];
  const snapDay = snap ? m.localDay(snap.at) : today;
  const job = (r) => ({ fit: Number(r['Fit Score']) || 0, role: String(r.Role || ''), company: String(r.Company || ''), country: String(r.Country || ''),
    found: day(r['Date Found']), verdict: String(r.Verdict || ''), why: String(r['Why It Fits'] || '').slice(0, 220),
    link: guard(r['Job Link']) && /^https?:\/\//i.test(String(r['Job Link'])) ? String(r['Job Link']) : '', row: r.row_number || null });

  // pipeline
  const funnel = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of rows) { const s = STAGES.includes(r.Status) ? r.Status : 'To apply'; funnel[s]++; }
  const sent = rows.filter((r) => SENT.includes(r.Status) || day(r['Applied On']));
  // a row marked Applied today has no date until the daily check stamps it: count it on the day the sheet was read
  const appliedDays = sent.map((r) => day(r['Applied On']) || snapDay);
  const perDay = {};
  for (const x of appliedDays) perDay[x] = (perDay[x] || 0) + 1;

  // streak: days in a row with 1+ application, ending today (or yesterday while today is still open)
  let streak = 0;
  for (let i = perDay[today] ? 0 : 1; perDay[dayOffset(i)]; i++) streak++;
  let best = 0, run = 0;
  const first = Object.keys(perDay).sort()[0];
  if (first) for (let x = first; x <= today; x = m.localDay(new Date(x + 'T12:00:00').getTime() + 86400000)) { run = perDay[x] ? run + 1 : 0; best = Math.max(best, run); }
  const weeks = Array.from({ length: 8 }, (_, i) => weekOf(dayOffset((7 - i) * 7)));
  const perWeek = weeks.map((w) => ({ week: w, n: appliedDays.filter((x) => weekOf(x) === w).length }));
  const allWeeks = {};
  for (const x of appliedDays) allWeeks[weekOf(x)] = (allWeeks[weekOf(x)] || 0) + 1;
  const bestWeek = Object.entries(allWeeks).sort((a, b) => b[1] - a[1])[0] || null;

  // today's mission: best open jobs, newest first among equal scores
  // older rows were added before some rules existed: jobs the finder would reject today (title words it excludes,
  // VIE = EU nationals only) are not suggested
  const search = m.profile(p).search;
  const exclude = (search.excludeTitleWords || []).map((w) => w.toLowerCase());
  const where = (j) => search.countries.includes(j.country) || (search.remote && /remote/i.test(j.country));
  const fits = (j) => where(j) && !/\bV\.?I\.?E\b/.test(j.role) && !exclude.some((w) => ` ${j.role.toLowerCase()} `.includes(w));
  const openAll = rows.filter((r) => (r.Status || 'To apply') === 'To apply').map(job).filter((j) => j.link);
  const open = openAll.filter(fits);
  open.sort((a, b) => b.fit - a.fit || b.found.localeCompare(a.found));
  const followUps = rows.filter((r) => r.Status === 'Applied' && /^Due/.test(String(r['Follow-up'] || ''))).map((r) => ({ ...job(r), applied: day(r['Applied On']) }));
  const interviews = rows.filter((r) => ['Interview', 'Offer'].includes(r.Status)).map((r) => ({ ...job(r), status: r.Status }));
  const appliedToday = perDay[today] || 0;
  const thisWeek = allWeeks[weekOf(today)] || 0;
  const stale = open.filter((j) => j.found && j.found <= dayOffset(5) && j.fit >= 70).length;

  // market pulse: what the daily search found per day, who hires, best match this week
  const finders = d.runs.filter((r) => r.profile === p && r.role === 'finder' && r.status === 'success' && r.finder);
  const market = Array.from({ length: 14 }, (_, i) => {
    const x = dayOffset(13 - i);
    const r = finders.find((f) => m.localDay(f.start) === x);
    return { day: x, found: r ? r.finder.unique : 0, kept: r ? r.finder.kept : 0, ran: Boolean(r) };
  });
  const recent = rows.filter((r) => day(r['Date Found']) >= dayOffset(13));
  const tally = (key) => { const t = {}; for (const r of recent) { const k = String(r[key] || '').trim(); if (k) t[k] = (t[k] || 0) + 1; } return Object.entries(t).sort((a, b) => b[1] - a[1]); };
  const week = rows.filter((r) => day(r['Date Found']) >= dayOffset(6)).map(job).filter(fits).sort((a, b) => b.fit - a.fit);
  const strong = (list) => list.filter((r) => (Number(r['Fit Score']) || 0) >= 75).length;

  // skills: the weekly AI summary, plus a live count of skills named in the jobs' "Gaps" column
  const weekly = weeklyInsights(p, d.runs);
  const gapCount = {};
  for (const r of rows.filter((x) => day(x['Date Found']) >= dayOffset(29))) {
    const seen = new Set();
    for (const [re, skill] of COURSES) if (re.test(String(r.Gaps || '')) && !seen.has(skill)) { seen.add(skill); gapCount[skill] = (gapCount[skill] || 0) + 1; }
  }
  const gaps = Object.entries(gapCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([skill, n]) => ({ skill, n, url: COURSES.find((c) => c[1] === skill)[2] }));

  // one clear next step
  let next;
  if (!snap) next = 'No sheet data yet: wait for the first daily run.';
  else if (followUps.length) next = `Send ${followUps.length} follow-up email${followUps.length > 1 ? 's' : ''} first (applied 7+ days ago, no answer yet).`;
  else if (interviews.some((j) => j.status === 'Interview')) next = 'Prepare for your interview: re-read the ad, write 3 stories from your CV that match it.';
  else if (appliedToday < DAILY_GOAL && open.length) next = `Apply to ${DAILY_GOAL - appliedToday} more job${DAILY_GOAL - appliedToday > 1 ? 's' : ''} today. Start with ${open[0].role} at ${open[0].company} (fit ${open[0].fit}).`;
  else if (appliedToday >= DAILY_GOAL) next = `Goal reached: ${appliedToday} applications today. Learn something from the skill gaps or rest.`;
  else next = 'No open jobs left to apply to. New ones arrive with tomorrow\'s email.';

  return {
    sheet: snap ? { at: snap.at, from: snap.from, rows: rows.length } : null,
    goal: { daily: DAILY_GOAL, weekly: WEEKLY_GOAL, today: appliedToday, week: thisWeek },
    next, mission: open.slice(0, 5), openCount: open.length, hidden: openAll.length - open.length, stale,
    funnel, applied: sent.length, responses: rows.filter((r) => ['Interview', 'Offer'].includes(r.Status)).length,
    followUps: followUps.slice(0, 8), interviews,
    streak: { current: streak, best, days: Array.from({ length: 28 }, (_, i) => { const x = dayOffset(27 - i); return { day: x, n: perDay[x] || 0 }; }) },
    weeks: perWeek, bestWeek: bestWeek ? { week: bestWeek[0], n: bestWeek[1] } : null,
    market: { days: market, companies: tally('Company').slice(0, 6), countries: tally('Country').slice(0, 6), bestThisWeek: week.slice(0, 3),
      foundWeek: week.length, strongWeek: strong(rows.filter((r) => day(r['Date Found']) >= dayOffset(6))) },
    skills: { weekly, gaps },
  };
}

function weeklyInsights(p, list) {
  const run = list.find((r) => r.profile === p && r.role === 'weekly' && r.status === 'success');
  if (!run) return null;
  const db = m.db();
  try {
    const row = db.prepare('select data from execution_data where executionId = ?').get(run.id);
    const rd = row ? ((m.unflat(row.data).resultData || {}).runData || {}) : {};
    const ai = (m.items(rd, 'AI: Weekly Insights')[0] || {}).output || {};
    const nums = m.items(rd, 'Weekly Numbers')[0] || {};
    const arr = (a) => (Array.isArray(a) ? a.map(String).slice(0, 6) : []);
    return { at: run.start, week: String(nums.weekOf || ''), topSkills: arr(ai.top_skills), topGaps: arr(ai.top_gaps).map((g) => ({ text: g, course: courseFor(g) })),
      learnNext: arr(ai.learn_next), advice: String(ai.advice || '').slice(0, 600) };
  } finally { db.close(); }
}

// project health: one score from delivery, security, tests, integrity and the AI budget, plus what was built lately
function project(d) {
  const parts = [];
  // only days since a person's first daily run count (a profile that started today is not punished for last week)
  const week = Object.values(d.delivery || {}).flatMap((x) => (x.week || []).filter((w) => w.live));
  const sentShare = week.length ? week.filter((x) => x.sent).length / week.length : 0;
  parts.push({ name: 'Emails delivered (7 days)', max: 30, score: Math.round(30 * sentShare), detail: `${week.filter((x) => x.sent).length} of ${week.length} expected daily emails arrived (both people)` });
  parts.push({ name: 'Security', max: 25, score: { secure: 25, elevated: 15, high: 5, critical: 0 }[d.threat] ?? 0, detail: `threat level ${d.threat}, ${d.findings.length} open finding(s)` });
  const rt = d.redteam;
  const rtFresh = rt && Date.now() - new Date(rt.at) < 7 * 86400000;
  parts.push({ name: 'Red-team tests', max: 20, score: rt ? Math.round(20 * rt.passed / rt.report.length * (rtFresh ? 1 : 0.5)) : 0, detail: rt ? `${rt.passed}/${rt.report.length} defended${rtFresh ? '' : ', older than 7 days'}` : 'never run' });
  const integ = d.integrity || [];
  parts.push({ name: 'Live = reviewed build', max: 15, score: integ.length ? Math.round(15 * integ.filter((w) => w.status === 'ok').length / integ.length) : 0, detail: `${integ.filter((w) => w.status === 'ok').length}/${integ.length} workflows` });
  const g = d.gemini && d.gemini.days[d.gemini.days.length - 1];
  const prod = g ? g.total - g.tests : 0;
  parts.push({ name: 'Gemini within free limit', max: 10, score: !g || prod <= d.gemini.cap ? 10 : 0, detail: `${prod}/${d.gemini ? d.gemini.cap : '?'} calls today` });

  let commits = [];
  try {
    commits = execFileSync('git', ['log', '-15', '--date=short', '--format=%h%x09%ad%x09%s'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
      .trim().split('\n').filter(Boolean).map((l) => { const [hash, date, ...s] = l.split('\t'); return { hash, date, subject: s.join('\t') }; });
  } catch { /* git missing */ }
  const days = new Set(commits.map((c) => c.date));
  let ideas = [];
  try {
    const log = fs.readFileSync(path.join(ROOT, 'PROGRESS_LOG.md'), 'utf8');
    const sec = (log.split(/^## IDEAS FOR LATER\s*$/m)[1] || '').split(/^## /m)[0];
    ideas = sec.split('\n').filter((l) => /^- /.test(l)).map((l) => ({ done: /~~/.test(l), text: l.replace(/^- /, '').replace(/~~/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
  } catch { /* no log */ }
  return { score: parts.reduce((s, x) => s + x.score, 0), parts, commits, buildDays: days.size, ideas, uncommitted: d.repo ? d.repo.uncommitted : null, unpushed: d.repo ? d.repo.unpushed : null };
}

function collect(d) {
  const out = { profiles: {}, project: null, errors: {} };
  for (const p of m.PROFILES) { try { out.profiles[p] = forProfile(p, d); } catch (e) { out.errors[p] = e.message; } }
  try { out.project = project(d); } catch (e) { out.errors.project = e.message; }
  return out;
}

module.exports = { collect, day, weekOf };
