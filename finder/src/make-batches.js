// Several jobs per AI call (the CV goes with every call). Each job gets Notes with facts the code already knows
// (location, short ad, non-English ad, VIE, too-senior title, sponsor register); those found blockers also go into `jobs` for the scoring rules.
// Ad text comes from job boards, so it is treated as data: text aimed at the AI is removed before it reaches the prompt (see aiSafe).
//@include lib/common.js
const c = CFG;
const squeeze = (t) => String(t || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
// the AI needs skills and experience, not contact details: email addresses and phone numbers stay on this laptop
const redact = (t) => t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
  .replace(/(?:\+|\b00)?\(?\d[\d\s().\/-]{7,}\d/g, (m) => ((m.match(/\d/g) || []).length >= 10 ? '[phone]' : m));
const resume = redact(squeeze($input.first().json.content)).slice(0, 7000);
// Ads end with company blurbs, benefits and legal text the AI does not need: cut there, then cap the length.
const CUT = /\n(about (us|the company)|who we are|what we offer|our offer|benefits|perks|why join|equal opportunit|we are an equal|diversity|privacy|how to apply)\b/i;
const slim = (t) => { const s = squeeze(t); const at = s.search(CUT); return (at > 400 ? s.slice(0, at) : s).slice(0, 2000); };
// Short snippets have few stopwords, so 6+ words without a single English stopword also count as not English.
const EN = ['the', 'and', 'with', 'for', 'you', 'our', 'will', 'are', 'your', 'we', 'to', 'of', 'in', 'is', 'as', 'on'];
const OTHER = ['und', 'der', 'die', 'mit', 'für', 'wir', 'het', 'een', 'voor', 'les', 'des', 'pour', 'avec', 'nous', 'los', 'las', 'para', 'con', 'una',
  'della', 'per', 'che', 'nel', 'delle', 'och', 'att', 'som', 'är', 'ja', 'tai', 'sekä', 'og', 'til', 'oraz'];
function notEnglish(ad) {
  const w = ad.toLowerCase().match(/\p{L}+/gu) || [];
  const en = w.filter((x) => EN.includes(x)).length, other = w.filter((x) => OTHER.includes(x)).length;
  return (other >= 3 && other > en) || (w.length >= 6 && en === 0);
}
const SENIOR = new RegExp('\\b(' + (c.tooSeniorTitleWords || []).join('|') + ')\\b', 'i');
// Calls for independent/freelance consultants want established experts with their own track record, not graduates.
const FREELANCE = /\b(independent consultant|freelance|freelancer)\b/i;
// Countries where English-only office jobs are rare: unless the ad mentions English, the local language is a risk.
// Not told to the AI (it then also cut must_haves, punishing twice): Gemini/Recheck Results cap the score at "maybe".
const LOCAL_LANGUAGE = { Germany: 'German', Austria: 'German', France: 'French', Italy: 'Italian', Spain: 'Spanish', Netherlands: 'Dutch', Sweden: 'Swedish' };
const SHORT_AD = 400;
const REGISTER = { UK: 'UK Home Office', Netherlands: 'Dutch IND' };

const sponsors = $('Visa & Rates').first().json.sponsors || {};
const todo = $('Get Job Details').all().map((i, n) => ({ ...i.json, n: n + 1 })).filter((j) => !j.skipReason);
const size = Math.max(1, Number(c.jobsPerAiCall) || 5);
const out = [];
for (let i = 0; i < todo.length; i += size) {
  const jobs = todo.slice(i, i + size).map((j) => {
    const ad = aiSafe(j.description ? slim(j.description) : '');
    const title = aiSafe(j.title), company = aiSafe(j.company);
    const remote = /remote/i.test(`${j.workMode} ${j.location}`);
    const blockers = [];
    // a local-language ad where the profile reads that language (for example German) is no blocker: it gets the language-risk cap below
    const localAd = ad && notEnglish(ad) && (c.readLocalLanguage || []).includes(j.country);
    if (ad && notEnglish(ad) && !localAd) blockers.push(['language', 'The ad text is not in English, so the job very likely requires the local language.']);
    if (/\bV\.?I\.?E\b/.test(j.title)) blockers.push(['eligibility', 'VIE is a French government programme open only to EU/EEA nationals aged 18-28.']);
    const senior = c.tooSeniorTitleWords && c.tooSeniorTitleWords.length && j.title.match(SENIOR);
    if (senior) blockers.push(['seniority', `"${senior[0]}" in the title: too senior for MY RESUME.`]);
    const freelance = j.title.match(FREELANCE);
    if (freelance) blockers.push(['seniority', `"${freelance[0]}" in the title: a call for established experts, not a graduate job.`]);
    const langRisk = localAd ? LOCAL_LANGUAGE[j.country] || 'local language'
      : !remote && LOCAL_LANGUAGE[j.country] && !/\benglish\b/i.test(`${j.title} ${ad}`) && !blockers.some(([b]) => b === 'language') ? LOCAL_LANGUAGE[j.country] : '';
    const sponsor = sponsors[j.id] || '';
    const register = REGISTER[j.country] || 'sponsor';
    const penalise = (c.sponsorPenalty || []).includes(j.country);
    const notes = [`Location check (done by code): ${j.country || 'the location'} is covered by ABOUT ME${remote ? ', and the job is remote' : ''}. Only use the "location" blocker if the ad text itself says the work must be done from somewhere else.`,
      ...(/^Yes/.test(sponsor) ? [`Visa check (done by code): the employer is on the ${register} register of licensed sponsors.`] : []),
      ...(/^Not on/.test(sponsor) && penalise ? [`Visa check (done by code): the employer is NOT on the ${register} sponsor register, so it cannot sponsor my visa: must_haves at most 5 unless the ad offers sponsorship.`] : []),
      ...blockers.map(([b, why]) => `Hard blocker found by code (${b}): ${why}`),
      ...(ad.length < SHORT_AD ? ['Only a short snippet of the ad is available: judge from title and snippet, and say in "gaps" what is unknown.'] : [])];
    return { id: 'J' + j.n, title: j.title, ad, remote, langRisk, blockers: blockers.map(([b]) => b), text: [
      `### JOB J${j.n}`,
      `Title: ${title}`, `Company: ${company}`, `Location: ${aiSafe(j.location || j.country)} (${j.country})${j.workMode ? ' – ' + aiSafe(j.workMode) : ''}`,
      `Ad text: ${ad || '(no ad text – judge from the title only and say so in "why")'}`,
      `Notes: ${notes.join(' ')}`,
    ].join('\n') };
  });
  out.push({ json: { resume, about: c.aboutMe || '', jobsText: jobs.map((j) => j.text).join('\n\n'), ids: jobs.map((j) => j.id), jobs: jobs.map(({ text, ...j }) => j) } });
}
return out.length ? out : [{ json: { nothingToScore: true } }];
