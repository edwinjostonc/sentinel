// Drop jobs already in the Jobs or Seen tab. Then fill the scoring limit in turns from each Germany/UK source (so NHS, Bundesagentur,
// startups... all get a share), newest first; other countries after that. Jobs over the limit stay unseen and come up again next run.
const c = $('Config').first().json;
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const seen = new Set();
for (const { json: r } of [...$('Get Jobs Already Logged').all(), ...$('Get Seen Jobs').all()]) {
  if (!r) continue;
  for (const l of String(r['Job Link'] || '').concat('\n', r['More Links'] || '').split('\n')) if (l.trim()) seen.add(l.trim());
  if (r.Key) seen.add(r.Key);
  if (r.Company && r.Role) seen.add(norm(r.Company) + '|' + norm(r.Role));
}
const fresh = $('Combine & Filter').all().map((i) => i.json).filter((j) => j.id)
  .filter((j) => !seen.has(j.key) && !seen.has(norm(j.company) + '|' + norm(j.title)) && !j.links.some((l) => seen.has(l)))
  .sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
const PRIMARY = c.primaryCountries || [];
const buckets = new Map();
for (const j of fresh.filter((x) => PRIMARY.includes(x.country))) {
  const b = j.country + '|' + j.source.split(' + ')[0];
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(j);
}
const picked = [];
while ([...buckets.values()].some((q) => q.length)) for (const q of buckets.values()) if (q.length) picked.push(q.shift());
picked.push(...fresh.filter((x) => !PRIMARY.includes(x.country)));
return picked.slice(0, c.maxJobsToScore).map((j) => ({ json: j }));
