// All job sources except LinkedIn and Adzuna, switched on per profile (finder/profiles/*.js). None of them need an API key:
// Careerjet, remote boards (Himalayas, Remotive), Arbeitnow, Bundesagentur (DE), NHS Jobs (UK), JobTech (Sweden's Arbetsförmedlingen),
// EURES (EU job portal) and company career pages (Greenhouse, Ashby, SmartRecruiters, Recruitee, Workable, Teamtailor).
//@include lib/common.js
const http = (url, opts = {}) => this.helpers.httpRequest({ url, json: true, timeout: 25000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept-Language': 'en', ...(opts.headers || {}) }, ...opts });
const stats = {};
const found = [];
const keepJob = (source, raw) => { stats[source] = stats[source] || { fetched: 0, kept: 0, errors: 0 }; stats[source].fetched++; const j = accept(job({ source, ...raw })); if (j) { stats[source].kept++; found.push(j); } };
const fail = (source, e) => { stats[source] = stats[source] || { fetched: 0, kept: 0, errors: 0 }; stats[source].errors++; stats[source].lastError = String(e.message || e).slice(0, 200); };
async function pool(tasks, n) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const t = tasks[i++]; try { await t(); } catch (e) { /* each task logs its own errors */ } } })); }
const ISO = { nl: 'Netherlands', ie: 'Ireland', mt: 'Malta', be: 'Belgium', lu: 'Luxembourg', de: 'Germany', at: 'Austria', fr: 'France', es: 'Spain', pt: 'Portugal', it: 'Italy', dk: 'Denmark', se: 'Sweden', fi: 'Finland', pl: 'Poland', cz: 'Czechia', gr: 'Greece', hu: 'Hungary', ro: 'Romania', cy: 'Cyprus', ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania', sk: 'Slovakia', si: 'Slovenia', hr: 'Croatia', bg: 'Bulgaria', gb: 'UK', uk: 'UK', ae: 'UAE', in: 'India' };
const PER = { Y: 'year', M: 'month', W: 'week', D: 'day', H: 'hour' };
const xml = (s, tag) => ((s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
const unescapeXml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const since = new Date(Date.now() - CFG.maxAgeDays * 86400000).toISOString().slice(0, 19);
const tasks = [];

// Careerjet: all search words in the core countries, the first 3 in the "more" countries.
// The API works without a partner id; careerjet.affid in the profile adds your own (careerjet.com/partners).
const CJ = CFG.careerjet || { core: {}, more: {} };
const CJ_AFFID = /^[0-9a-f]{16,32}$/i.test(CJ.affid || '') ? { affid: CJ.affid } : {};
for (const [locale, country] of [...Object.entries(CJ.core || {}), ...Object.entries(CJ.more || {})]) {
  const words = (CJ.core || {})[locale] ? WORDS : WORDS.slice(0, 3);
  for (const w of words) tasks.push(async () => {
    try {
      const r = await http('http://public.api.careerjet.net/search', { headers: { Referer: 'http://localhost/job-finder' },
        qs: { locale_code: locale, keywords: w, sort: 'date', pagesize: 50, page: 1, ...CJ_AFFID, user_ip: '127.0.0.1', user_agent: 'Mozilla/5.0' } });
      for (const j of (r.jobs || [])) keepJob('Careerjet', { id: 'CJ-' + String(j.url || '').slice(-40), title: j.title, company: j.company, location: j.locations,
        country: countryOf(j.locations) || country, link: j.url, posted: day(j.date), description: j.description,
        salary: j.salary_min || j.salary_max ? { min: Number(j.salary_min) || 0, max: Number(j.salary_max) || 0, cur: j.salary_currency_code || '', per: PER[j.salary_type] || 'year' } : null });
    } catch (e) { fail('Careerjet', e); }
  });
}

// remote boards
const REMOTE_OK = CFG.remoteWhere ? new RegExp(CFG.remoteWhere, 'i') : null;
if (CFG.remote && REMOTE_OK) {
  for (const w of WORDS.slice(0, 4)) tasks.push(async () => {
    try {
      const r = await http('https://himalayas.app/jobs/api/search', { qs: { q: w, limit: 20 } });
      for (const j of (r.jobs || [])) {
        const where = (j.locationRestrictions || []).join(', ');
        if (where && !REMOTE_OK.test(where) && !countryOf(where)) continue;
        keepJob('Himalayas', { id: 'HM-' + j.guid, title: j.title, company: j.companyName, location: where || 'Remote (worldwide)', country: countryOf(where) || 'Remote',
          workMode: 'Remote', link: j.applicationLink || j.guid, posted: day(Number(j.pubDate) * 1000), description: j.description || j.excerpt,
          salary: j.minSalary || j.maxSalary ? { min: j.minSalary || 0, max: j.maxSalary || 0, cur: j.currency || '', per: j.salaryPeriod === 'annual' ? 'year' : (j.salaryPeriod || 'year') } : null });
      }
    } catch (e) { fail('Himalayas', e); }
    try {
      const r = await http('https://remotive.com/api/remote-jobs', { qs: { search: w, limit: 50 } });
      for (const j of (r.jobs || [])) {
        const where = j.candidate_required_location || '';
        if (!(REMOTE_OK.test(where) || countryOf(where))) continue;
        keepJob('Remotive', { id: 'RM-' + j.id, title: j.title, company: j.company_name, location: where, country: countryOf(where) || 'Remote',
          workMode: 'Remote', link: j.url, posted: day(j.publication_date), description: j.description });
      }
    } catch (e) { fail('Remotive', e); }
  });
}

// Arbeitnow (mostly Germany, many English ads)
if (CFG.useArbeitnow) for (const page of [1, 2, 3]) tasks.push(async () => {
  try {
    const r = await http('https://www.arbeitnow.com/api/job-board-api', { qs: { page } });
    for (const j of (r.data || [])) keepJob('Arbeitnow', { id: 'AN-' + j.slug, title: j.title, company: j.company_name, location: j.location,
      workMode: j.remote ? 'Remote' : '', link: j.url, posted: day(Number(j.created_at) * 1000), description: j.description });
  } catch (e) { fail('Arbeitnow', e); }
});

// Bundesagentur für Arbeit (official German job board, also lists jobs posted by other boards); full ad text in Get Job Details
if (CFG.bundesagentur) for (const was of CFG.bundesagentur.terms) for (const angebotsart of [1, 34]) tasks.push(async () => {   // 1 = job, 34 = internship/trainee
  try {
    const r = await http('https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs', { headers: { 'X-API-Key': 'jobboerse-jobsuche' },
      qs: { was, angebotsart, veroeffentlichtseit: CFG.maxAgeDays, size: 100, page: 1 } });
    for (const j of (r.ergebnisliste || [])) {
      const a = ((j.stellenlokationen || [])[0] || {}).adresse || {};
      if (a.land && a.land !== 'DEUTSCHLAND') continue;   // the board also lists jobs abroad
      keepJob('Bundesagentur', { id: 'BA-' + j.referenznummer, title: j.stellenangebotsTitel, company: j.firma, location: [a.ort, 'Germany'].filter(Boolean).join(', '),
        country: 'Germany', workMode: j.homeofficemoeglich ? 'Hybrid' : '', link: j.externeURL || `https://www.arbeitsagentur.de/jobsuche/jobdetail/${j.referenznummer}`,
        posted: day(j.datumErsteVeroeffentlichung), description: '',
        detail: { kind: 'ba', url: `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/${btoa(j.referenznummer)}` } });
    }
  } catch (e) { fail('Bundesagentur', e); }
});

// NHS Jobs (UK health service): XML feed sorted by relevance, 10 per page, so 3 pages per word; full ad text in Get Job Details
if (CFG.nhs) for (const keyword of CFG.nhs.terms) for (const page of [1, 2, 3]) tasks.push(async () => {
  try {
    const t = String(await http('https://www.jobs.nhs.uk/api/v1/search_xml', { json: false, qs: { keyword, page } }));
    for (const v of t.split('<vacancyDetails>').slice(1)) {
      const ref = xml(v, 'reference'), pay = (xml(v, 'salary').match(/[\d,]+(\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, '')));
      if (!/^[\w-]+$/.test(ref)) continue;
      keepJob('NHS Jobs', { id: 'NHS-' + ref, title: xml(v, 'title'), company: xml(v, 'employer'), location: xml(v, 'location') + ', UK', country: 'UK',
        link: `https://www.jobs.nhs.uk/candidate/jobadvert/${ref}`, posted: day(xml(v, 'postDate')), description: '', maxAgeDays: CFG.nhs.maxAgeDays,
        salary: pay.length && pay[0] > 1000 ? { min: pay[0], max: pay[1] || pay[0], cur: 'GBP', per: 'year' } : null,
        detail: { kind: 'nhs', url: `https://www.jobs.nhs.uk/candidate/jobadvert/${ref}` } });
    }
  } catch (e) { fail('NHS Jobs', e); }
});

// JobTech: Sweden's public employment service (Arbetsförmedlingen), full ad text included
if (CFG.jobtech) for (const q of CFG.jobtech.terms) tasks.push(async () => {
  try {
    const r = await http('https://jobsearch.api.jobtechdev.se/search', { headers: { accept: 'application/json' }, qs: { q, limit: 100, 'published-after': since } });
    for (const j of (r.hits || [])) {
      const a = j.workplace_address || {};
      keepJob('JobTech', { id: 'JT-' + j.id, title: j.headline, company: (j.employer || {}).name, location: [a.city || a.municipality, 'Sweden'].filter(Boolean).join(', '),
        country: 'Sweden', link: j.webpage_url || (j.application_details || {}).url, posted: day(j.publication_date),
        description: ((j.description || {}).text || '') + (j.salary_description ? `\nSalary: ${j.salary_description}` : '') });
    }
  } catch (e) { fail('JobTech', e); }
});

// EURES: the EU's job portal (national employment services of all EU countries), full ad text included
if (CFG.eures) for (const cc of CFG.eures.countries) for (const keyword of CFG.eures.terms) tasks.push(async () => {
  try {
    const r = await http('https://europa.eu/eures/api/jv-searchengine/public/jv-search/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: { resultsPerPage: 50, page: 1, sortSearch: 'MOST_RECENT', keywords: [{ keyword, specificSearchCode: 'EVERYWHERE' }], publicationPeriod: 'LAST_WEEK',
        occupationUris: [], skillUris: [], requiredExperienceCodes: [], positionScheduleCodes: [], sectorCodes: [], educationAndQualificationLevelCodes: [],
        positionOfferingCodes: [], locationCodes: [cc], euresFlagCodes: [], otherBenefitsCodes: [], requiredLanguages: [], minNumberPost: null, sessionId: 'job-finder' } });
    for (const j of (r.jvs || [])) {
      const en = (j.translations || {}).en || {};
      const country = ISO[Object.keys(j.locationMap || {})[0]?.toLowerCase()] || ISO[cc];
      keepJob('EURES', { id: 'EU-' + j.id, title: en.title || j.title, company: (j.employer || {}).name, location: country, country,
        link: `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(j.id)}?lang=en`, posted: day(j.creationDate), description: en.description || j.description });
    }
  } catch (e) { fail('EURES', e); }
});

// company career pages, from the profile; jobs elsewhere are dropped by the country filter
for (const [ats, slug] of (CFG.companyBoards || [])) tasks.push(async () => {
  const src = 'Company boards';
  const keep = (s, raw) => keepJob(s, { ...raw, maxAgeDays: CFG.companyBoardMaxAgeDays });
  if (!/^[\w.-]+$/.test(slug)) return fail(src, new Error(`bad board name ${slug}`));
  try {
    if (ats === 'smartrecruiters') {
      for (let offset = 0; offset < 400; offset += 100) {
        const r = await http(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, { qs: { limit: 100, offset } });
        for (const j of (r.content || [])) keep(src, { id: 'SR-' + j.id, title: j.name, company: (j.company && j.company.name) || slug,
          location: (j.location && j.location.fullLocation) || '', country: ISO[String((j.location || {}).country || '').toLowerCase()] || '',
          workMode: j.location && j.location.remote ? 'Remote' : j.location && j.location.hybrid ? 'Hybrid' : '',
          link: `https://jobs.smartrecruiters.com/${slug}/${j.id}`, posted: day(j.releasedDate), description: '',
          detail: { kind: 'smartrecruiters', url: `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.id}` } });
        if (!r.content || r.content.length < 100) break;
      }
    } else if (ats === 'recruitee') {
      const r = await http(`https://${slug}.recruitee.com/api/offers/`);
      for (const j of (r.offers || [])) keep(src, { id: 'RC-' + j.id, title: j.title, company: j.company_name || slug, location: j.location,
        country: ISO[String(j.country_code || '').toLowerCase()] || '', workMode: j.remote ? 'Remote' : j.hybrid ? 'Hybrid' : '',
        link: j.careers_url, posted: day(String(j.published_at || j.created_at || '').replace(' UTC', 'Z').replace(' ', 'T')),
        description: (j.description || '') + '\n' + (j.requirements || '') });
    } else if (ats === 'workable') {
      const r = await http(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
      for (const j of (r.jobs || [])) keep(src, { id: 'WK-' + j.shortcode, title: j.title, company: r.name || slug, location: [j.city, j.country].filter(Boolean).join(', '),
        country: countryOf(j.country), workMode: j.telecommuting ? 'Remote' : '', link: j.url, posted: day(j.published_on || j.created_at), description: '' });
    } else if (ats === 'ashby') {
      const r = await http(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      for (const j of (r.jobs || [])) {
        const where = [j.location, ...((j.secondaryLocations || []).map((s) => s.location))].join(' / ');
        keep(src, { id: 'AS-' + j.id, title: j.title, company: slug.charAt(0).toUpperCase() + slug.slice(1), location: where, country: countryOf(j.location, where),
          workMode: j.isRemote ? 'Remote' : (j.workplaceType || ''), link: j.jobUrl, posted: day(j.publishedAt), description: j.descriptionPlain });
      }
    } else if (ats === 'greenhouse') {
      const r = await http(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { qs: { content: 'true' } });
      for (const j of (r.jobs || [])) keep(src, { id: 'GH-' + j.id, title: j.title, company: j.company_name || slug, location: (j.location || {}).name,
        workMode: /remote/i.test((j.location || {}).name) ? 'Remote' : '', link: j.absolute_url, posted: day(j.first_published || j.updated_at), description: strip(j.content) });
    } else if (ats === 'teamtailor') {
      // public RSS feed of the career page (many Swedish companies use Teamtailor)
      const t = String(await http(`https://${slug}.teamtailor.com/jobs.rss`, { json: false }));
      for (const it of t.split('<item>').slice(1)) {
        const city = xml(it, 'tt:city'), country = xml(it, 'tt:country');
        keep(src, { id: 'TT-' + xml(it, 'guid'), title: unescapeXml(xml(it, 'title')), company: unescapeXml(xml(it, 'company_name')) || slug,
          location: [city, country].filter(Boolean).join(', '), country: countryOf(country, city), workMode: /fully|remote/i.test(xml(it, 'remoteStatus')) ? 'Remote' : '',
          link: xml(it, 'link'), posted: day(xml(it, 'pubDate')), description: unescapeXml(xml(it, 'description')) });
      }
    }
  } catch (e) { fail(src, e); }
});

await pool(tasks, 6);
return found.map((j) => ({ json: j })).concat([{ json: { _stats: stats } }]);
