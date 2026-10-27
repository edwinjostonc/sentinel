// Fetch full descriptions where the search only gave a title, then re-run the language checks.
// Jobs that fail get a skipReason and go straight to the Seen tab.
//@include lib/common.js
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept-Language': 'en' };
const ENROLLED = /\b(currently enrolled|must be enrolled|enrolled (student|in a|at a)|immatrikuliert|eingeschrieben|pflichtpraktikum|mandatory internship|compulsory internship|curricular internship|internship agreement with your university|current(ly)? (a )?student)/i;
const out = [];
let linkedInBlocked = false;
for (const { json } of $input.all()) {
  const j = { ...json, skipReason: '' };
  if (j.detail && !j.description) {
    try {
      if (j.detail.kind === 'linkedin' && !linkedInBlocked) {
        await sleep(1200 + Math.random() * 1000);
        const html = String(await this.helpers.httpRequest({ url: j.detail.url, headers: UA, timeout: 25000 }));
        j.description = strip((html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1]).slice(0, 6000);
        const level = strip((html.match(/Seniority level<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
        if (level) j.description = `Seniority level: ${level}\n` + j.description;
        if (/No longer accepting applications/i.test(html)) j.skipReason = 'Closed';
      } else if (j.detail.kind === 'smartrecruiters') {
        const d = await this.helpers.httpRequest({ url: j.detail.url, json: true, timeout: 25000 });
        const s = (d.jobAd && d.jobAd.sections) || {};
        j.description = strip(['jobDescription', 'qualifications', 'additionalInformation'].map((k) => (s[k] && s[k].text) || '').join('\n')).slice(0, 6000);
      } else if (j.detail.kind === 'nhs') {
        const html = String(await this.helpers.httpRequest({ url: j.detail.url, headers: UA, timeout: 25000 }));
        const from = html.indexOf('id="job_overview"'), to = html.indexOf('id="employer_name_details"', from);
        if (from > 0) j.description = strip(html.slice(from - 50, to > from ? to : from + 30000).replace(/^[^>]*>/, '')).slice(0, 6000);
        if (/This job is (now )?closed|no longer accepting applications/i.test(html)) j.skipReason = 'Closed';
      } else if (j.detail.kind === 'ba') {
        const r = await this.helpers.httpRequest({ url: j.detail.url, json: true, timeout: 25000, headers: { 'X-API-Key': 'jobboerse-jobsuche' },
          ignoreHttpStatusErrors: true, returnFullResponse: true });
        if (r.statusCode === 404) j.skipReason = 'Closed';
        else if (r.body && r.body.stellenangebotsBeschreibung) j.description = strip(r.body.stellenangebotsBeschreibung).slice(0, 6000);
      }
    } catch (e) {
      if (/429|999/.test(String(e.message))) linkedInBlocked = true;
    }
  }
  if (!j.skipReason && j.description) {
    const lang = requiredLanguage(j.title + '\n' + j.description);
    if (lang) j.skipReason = `Needs ${lang}`;
    else if (![...ENGLISH_COUNTRIES, ...LOCAL_OK].includes(j.country) && !isEnglish(j.description)) j.skipReason = 'Ad not in English';
    // graduates: internships only open to enrolled students are out
    else if (/intern|praktik|trainee|stage\b/i.test(j.title) && ENROLLED.test(j.description)) j.skipReason = 'Internship for enrolled students';
  }
  // ads asking for 5+ years would score low anyway: skip them without spending an AI call
  if (!j.skipReason && j.description) {
    const asked = [...j.description.matchAll(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}?experience/gi)].map((m) => Number(m[1]));
    const years = asked.length ? Math.max(...asked) : 0;
    // bigger numbers are mostly the company's age ("30 years of experience in healthcare")
    if (years >= 5 && years <= 15) j.skipReason = `Needs ${years}+ years experience`;
    else if (/Seniority level: (Director|Executive)/i.test(j.description)) j.skipReason = 'Director level';
  }
  // ad text that tries to instruct the AI: cut before scoring (Make Batches), score capped and flagged (Build Rows)
  j.suspicious = looksInjected(`${j.title}\n${j.company}\n${j.description}`);
  delete j.detail;
  out.push({ json: j });
}
return out;
