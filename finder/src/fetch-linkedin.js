// LinkedIn guest search (no login); queries, places and experience levels come from the profile. Stops early if LinkedIn rate-limits us.
//@include lib/common.js
const found = [], stats = { LinkedIn: { fetched: 0, kept: 0, errors: 0 } };
if (CFG.useLinkedIn) {
  const QUERIES = CFG.linkedInQueries || [];
  const dec = (s) => strip(String(s || ''));
  let retried = false;
  outer:
  for (const location of CFG.linkedInLocations) {
    for (const q of QUERIES) {
      for (const start of [0, 10]) {
        let html = '';
        // a rate limit (429/999) gets one pause and retry for the whole run; a second one stops LinkedIn for today
        for (;;) {
          try {
            html = await this.helpers.httpRequest({ url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search', timeout: 25000,
              qs: { keywords: q, location, f_TPR: 'r' + CFG.maxAgeDays * 86400, f_E: CFG.linkedInLevels || '2,3', start },
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept-Language': 'en' } });
            break;
          } catch (e) {
            stats.LinkedIn.errors++; stats.LinkedIn.lastError = String(e.message || e).slice(0, 200);
            if (!/429|999/.test(String(e.message))) break;
            if (retried) break outer;
            retried = true;
            await sleep(30000);
          }
        }
        if (!html) continue;
        const cards = String(html).split('<li>').slice(1);
        for (const c of cards) {
          const id = (c.match(/urn:li:jobPosting:(\d+)/) || [])[1];
          if (!id) continue;
          stats.LinkedIn.fetched++;
          const pick = (rx) => dec((c.match(rx) || [])[1]);
          const where = pick(/job-search-card__location">([\s\S]*?)<\/span>/);
          const j = accept(job({ source: 'LinkedIn', id: 'LI-' + id, title: pick(/base-search-card__title">([\s\S]*?)<\/h3>/),
            company: pick(/base-search-card__subtitle">([\s\S]*?)<\/h4>/),
            location: where, country: countryOf(where) || countryOf(location), link: `https://www.linkedin.com/jobs/view/${id}/`,
            posted: (c.match(/datetime="([\d-]+)"/) || [])[1] || '', description: '',
            detail: { kind: 'linkedin', url: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}` } }));
          if (j) { stats.LinkedIn.kept++; found.push(j); }
        }
        if (cards.length < 10) break;
        await sleep(2000 + Math.random() * 1500);
      }
    }
  }
}
return found.map((j) => ({ json: j })).concat([{ json: { _stats: stats } }]);
