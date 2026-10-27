// Daily sheet check: fill in Applied On, flag follow-ups after 7 days, mark dead job links as Expired.
// Job links come from the sheet, which people can edit: only public web addresses are opened (lib/net-guard.js).
//@include lib/net-guard.js
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept-Language': 'en' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = $now.startOf('day');
// accepts 2026-10-04, 04/10/2026, 4.10.2026 (day first) or a Sheets serial number
function parse(v) {
  const s = String(v || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return DateTime.fromObject({ year: +m[1], month: +m[2], day: +m[3] });
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) return DateTime.fromObject({ year: m[3].length === 2 ? 2000 + +m[3] : +m[3], month: +m[2], day: +m[1] });
  if (/^\d{5}$/.test(s)) return DateTime.fromObject({ year: 1899, month: 12, day: 30 }).plus({ days: +s });
  return null;
}
const GONE = /(no longer (available|accepting|active|open)|job (has )?expired|position (has been )?(filled|closed)|vacancy (is )?(closed|expired)|this job is (closed|no longer)|vacature is (niet meer|gesloten|verlopen)|stelle ist nicht mehr|offre (n'est plus|expirée))/i;
const ashbyBoards = {};
async function isGone(link) {
  if (!publicUrl(link)) return false;
  // Ashby job pages return 200 even when the job is gone, so check the board API
  const ashby = String(link).match(/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/i);
  if (ashby) {
    ashbyBoards[ashby[1]] = ashbyBoards[ashby[1]] || await this.helpers.httpRequest({ url: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}`, json: true, timeout: 25000 });
    return !(ashbyBoards[ashby[1]].jobs || []).some((j) => j.id === ashby[2]);
  }
  const sr = String(link).match(/jobs\.smartrecruiters\.com\/([^/]+)\/(\d+)/);
  if (sr) {
    const r = await this.helpers.httpRequest({ url: `https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings/${sr[2]}`, json: true, timeout: 25000, returnFullResponse: true, ignoreHttpStatusErrors: true });
    return r.statusCode === 404 || (r.body && r.body.active === false);
  }
  const li = String(link).match(/linkedin\.com\/jobs\/view\/(\d+)/);
  const url = li ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li[1]}` : link;
  const r = await publicGet(this.helpers, url, UA);
  if (r.refused) return false;   // not a public web address: never opened, the row is left alone
  if ([404, 410].includes(r.statusCode)) return true;
  if (r.statusCode >= 300) return false;   // blocked, server error or too many redirects: try again tomorrow
  return GONE.test(String(r.body || '').slice(0, 300000));
}

const rows = $input.all().map((i) => i.json).filter((r) => r && r.row_number);
const updates = [];
let checks = 0;
for (const r of rows) {
  const u = { row_number: r.row_number, Status: r.Status || '', 'Applied On': r['Applied On'] || '', 'Follow-up': r['Follow-up'] || '' };
  let changed = false;
  if (u.Status === 'Applied' && !u['Applied On']) { u['Applied On'] = today.toFormat('yyyy-MM-dd'); changed = true; }
  const applied = parse(u['Applied On']);
  if (u.Status === 'Applied' && !u['Follow-up'] && applied && today.diff(applied, 'days').days >= 7) { u['Follow-up'] = 'Due – send a short follow-up'; changed = true; }
  const found = parse(r['Date Found']);
  if (u.Status === 'To apply' && r['Job Link'] && found && today.diff(found, 'days').days >= 2 && checks < 50) {
    checks++;
    try { if (await isGone.call(this, r['Job Link'])) { u.Status = 'Expired'; changed = true; } } catch (e) { /* network problem: check again tomorrow */ }
    await sleep(/linkedin/.test(r['Job Link']) ? 2000 : 400);
  }
  if (changed) updates.push({ json: u });
}
return updates;
