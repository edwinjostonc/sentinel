// Combine all sources and merge duplicates.
//@include lib/common.js
const stats = {};
const jobs = [];
const take = (items) => { for (const { json: j } of items) { if (j._stats) Object.assign(stats, j._stats); else if (j.id) jobs.push(j); } };
take($('Fetch Job Boards').all());
take($('Fetch LinkedIn').all());

if (CFG.useAdzuna) {
  stats.Adzuna = { fetched: 0, kept: 0, errors: 0 };
  for (const { json: r } of $('Adzuna Search').all()) {
    if (!Array.isArray(r.results)) { stats.Adzuna.errors++; stats.Adzuna.lastError = String(r.error && r.error.message || r.message || 'no results').slice(0, 200); continue; }
    for (const a of r.results) {
      stats.Adzuna.fetched++;
      const area = ((a.location || {}).area || []).join(', ');
      const j = accept(job({ source: 'Adzuna', id: 'AZ-' + a.id, title: a.title, company: (a.company || {}).display_name, location: (a.location || {}).display_name,
        country: countryOf(area, (a.location || {}).display_name), link: a.redirect_url, posted: day(a.created), description: a.description,
        salary: a.salary_min || a.salary_max ? { min: a.salary_min || 0, max: a.salary_max || 0, cur: '', per: 'year', country: countryOf(area) } : null }));
      if (j) { stats.Adzuna.kept++; jobs.push(j); }
    }
  }
}

// Duplicate key: first word of company + title + country, so "Acre" matches "Acre Resources".
const normCo = (s) => (pad(s).replace(/\b(the)\b/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/)[0] || '');
const normTitle = (s) => pad(s).replace(/\(?\b[mwfdx]\s*\/\s*[mwfdx](\s*\/\s*[mwfdx])?\b\)?|\(all genders?\)|\(h\/f\)|\(f\/h\)/g, ' ').replace(/[^\p{L}\p{N}]/gu, '');
const byKey = new Map();
for (const j of jobs) {
  const key = normCo(j.company) + '|' + normTitle(j.title) + '|' + j.country;
  const have = byKey.get(key);
  if (!have) { byKey.set(key, { ...j, key, links: [j.link], sources: [j.source] }); continue; }
  if (!have.links.includes(j.link)) have.links.push(j.link);
  if (!have.sources.includes(j.source)) have.sources.push(j.source);
  // keep the version with the longest description
  if ((j.description || '').length > (have.description || '').length) Object.assign(have, { ...j, key, links: have.links, sources: have.sources });
  if (!have.salary && j.salary) have.salary = j.salary;
}
const merged = [...byKey.values()].map((j) => ({ ...j, moreLinks: j.links.filter((l) => l !== j.link).join('\n'), source: j.sources.join(' + ') }));
return merged.map((j) => ({ json: j })).concat([{ json: { _stats: stats, total: jobs.length, unique: merged.length } }]);
