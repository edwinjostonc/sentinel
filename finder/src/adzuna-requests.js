// Adzuna search URLs. The API key comes from the "Adzuna" credential on the HTTP node.
// When Adzuna is off we still emit one item so the next nodes run.
const c = $('Config').first().json;
if (!c.useAdzuna) return [{ json: { skip: true, url: 'https://api.adzuna.com/v1/api/version' } }];
// Adzuna country codes for the profile's countries; the first one or two (primaryCountries) get every search word, the rest the first 3
const CODE = { UK: 'gb', Germany: 'de', Netherlands: 'nl', India: 'in', Austria: 'at', Belgium: 'be', France: 'fr', Spain: 'es', Italy: 'it', Poland: 'pl' };
const words = [...c.searchWords, ...(c.includeSalesJobs ? c.salesSearchWords : [])];
const out = [];
for (const name of c.countries.filter((x) => CODE[x])) for (const w of ((c.primaryCountries || []).includes(name) ? words : words.slice(0, 3))) {
  out.push({ json: { country: CODE[name], url: `https://api.adzuna.com/v1/api/jobs/${CODE[name]}/search/1?results_per_page=50&sort_by=date&max_days_old=${c.maxAgeDays}&what=${encodeURIComponent(w)}&content-type=application/json` } });
}
return out.length ? out : [{ json: { skip: true, url: 'https://api.adzuna.com/v1/api/version' } }];
