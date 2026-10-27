// Merge AI scores with the job data into one row per job.
const c = $('Config').first().json;
const jobs = $('Get Job Details').all().map((i, n) => ({ ...i.json, n: n + 1 }));
const vr = $('Visa & Rates').first().json;
const fx = vr.fx || null;
const ai = {}, rechecked = new Set();
// first scores from Gemini Flash-Lite, then the stronger model's second check of the best jobs (it wins)
for (const node of ['Gemini Results', 'Recheck Results']) {
  let items = [];
  try { items = $(node).all(); } catch (e) { /* this node did not run this time */ }
  for (const it of items) for (const r of (it.json.results || [])) if (r && r.id) {
    const id = String(r.id).trim().toUpperCase();
    ai[id] = r;
    if (node === 'Recheck Results') rechecked.add(id);
  }
}
// recruitment agencies: the sponsor list shows the agency, not the real employer
const AGENCY = /\b(recruit\w*|staffing|personnel|resourcing|talent solutions|headhunt\w*|michael page|page personnel|hays|robert half|robert walters|randstad|adecco|manpower|reed|harvey nash|sthree|computer futures|progressive recruitment|hamilton barnes|matchtech|tekwissen|datatech|optimum|ferchau|persona service|brunel|gulp|etengo|amadeus fire|experis|modis|akkodis|allegis|aerotek|kforce|tempton|orizon|hofmann|dis ag|jobvalley|academic work|nigel frank|jefferson frank|cpl|morgan mckinley|huxley|spring professional)\b/i;
const SHORT_AD = 400;   // Careerjet and some boards only give a snippet
const SUSPICIOUS_MAX = 50;

const CUR = { Germany: 'EUR', Netherlands: 'EUR', Austria: 'EUR', Ireland: 'EUR', UK: 'GBP', Sweden: 'SEK', India: 'INR', UAE: 'AED' };
const SYM = { EUR: '€', INR: '₹', USD: '$', GBP: '£', AED: 'AED ', SEK: 'SEK ' };
const YEAR = { year: 1, month: 12, week: 52, day: 220, hour: 1760 };
const CUR2 = c.currency2 || 'GBP';   // the second salary column (for example GBP or INR)
const k = (v) => (v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));
// rupees read naturally in lakh: ₹12.5L
const amount = (cur, v) => (cur === 'INR' ? `${Math.round(v / 10000) / 10}L` : k(v));
function salary(s, country) {
  if (!s || !(s.min || s.max)) return ['', '', ''];
  const cur = (s.cur || CUR[s.country || country] || 'EUR').toUpperCase();
  const lo = s.min || s.max, hi = s.max || s.min, f = YEAR[s.per] || 1;
  const given = `${SYM[cur] || cur + ' '}${Math.round(lo).toLocaleString('en')}${hi !== lo ? '–' + Math.round(hi).toLocaleString('en') : ''} / ${s.per || 'year'}`;
  if (!fx || !fx[cur]) return [given, '', ''];
  const eLo = (lo * f) / fx[cur], eHi = (hi * f) / fx[cur];
  const eur = `€${k(eLo)}${eHi !== eLo ? '–' + k(eHi) : ''}`;
  const sym2 = SYM[CUR2] || CUR2 + ' ';
  const second = fx[CUR2] ? `${sym2}${amount(CUR2, eLo * fx[CUR2])}${eHi !== eLo ? '–' + amount(CUR2, eHi * fx[CUR2]) : ''}` : '';
  return [given, eur, second];
}
// Drop "Add '...'" suggestions that quote things not in the CV (the model sometimes invents skills).
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const cvText = squash(($('Get Master Resume').first().json || {}).content);
function truthful(s) {
  if (!/^\s*add\b/i.test(s)) return true;
  const parts = [...s.matchAll(/['‘’"“”]([^'‘’"“”]+)['‘’"“”]/g)].flatMap((m) => m[1].split(/,|\(|\)|\band\b|&|\//)).map((t) => t.trim()).filter((t) => t.length > 2);
  return parts.length > 0 && parts.every((p) => cvText.includes(squash(p)));
}
const today = $now.toFormat('yyyy-MM-dd');
const rows = jobs.map((j) => {
  const r = ai['J' + j.n] || null;
  const raw = r && Number.isFinite(Number(r.fit_score)) ? Math.max(0, Math.min(100, Math.round(Number(r.fit_score)))) : 0;
  // an ad that tried to talk to the AI cannot buy itself a top score
  const fit = j.suspicious ? Math.min(raw, SUSPICIOUS_MAX) : raw;
  const [sal, eur, second] = salary(j.salary, j.country);
  const agency = AGENCY.test(j.company);
  const adNote = r && r.visa_note && !/not mentioned/i.test(r.visa_note) ? r.visa_note : '';
  const visa = agency && ['UK', 'Netherlands'].includes(j.country) ? 'Agency – check who the employer is' + (adNote ? ' · Ad: ' + adNote : '')
    : (vr.sponsors && vr.sponsors[j.id]) ? vr.sponsors[j.id] + (adNote ? ' · Ad: ' + adNote : '')
    : (r && r.visa_note) || '';
  const shortAd = (j.description || '').length < SHORT_AD;
  const flags = [j.suspicious && 'Odd ad text aimed at AI tools – treat with care', shortAd && 'Short ad – read the full ad before applying',
    agency && 'Recruitment agency – find out the real employer', rechecked.has('J' + j.n) && 'Double-checked by stronger AI'].filter(Boolean);
  return { ...j, fit, today, scored: Boolean(r),
    verdict: fit >= 75 ? 'Strong' : fit >= 55 ? 'Good' : fit >= 40 ? 'Possible' : 'Weak',
    why: r ? String(r.why || '').trim() : '', gaps: r ? String(r.gaps || '').trim() : '',
    resumeChanges: r ? String(r.resume_changes || '').split(/\s*\|\s*/).filter(Boolean).filter(truthful).map((s) => '• ' + s).join('\n') : '',
    visa, language: r ? String(r.language_note || '').trim() : '', salaryText: sal, salaryEur: eur, salary2: second, shortAd, agency, flags,
    keep: Boolean(r) && !j.skipReason && fit >= c.minFitScoreToLog,
    note: j.skipReason || (r ? `${j.company} – ${j.title}` : `Not scored (AI unavailable) – ${j.company} – ${j.title}`) };
}).sort((a, b) => b.fit - a.fit);
return rows.map((r) => ({ json: r }));
