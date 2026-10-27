// Stats for the last 7 days and a short job list for the AI.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.Role);
const since = $now.minus({ days: 7 }).toFormat('yyyy-MM-dd');
const week = rows.filter((r) => String(r['Date Found'] || '') >= since);
const count = (f) => rows.filter(f).length;
const best = [...week].sort((a, b) => Number(b['Fit Score']) - Number(a['Fit Score'])).slice(0, 25);
const byCountry = {};
for (const r of week) byCountry[r.Country || '?'] = (byCountry[r.Country || '?'] || 0) + 1;
return [{ json: {
  weekOf: $now.minus({ days: 6 }).toFormat('yyyy-MM-dd') + ' → ' + $now.toFormat('yyyy-MM-dd'),
  found: week.length,
  strong: week.filter((r) => Number(r['Fit Score']) >= 75).length,
  appliedTotal: count((r) => ['Applied', 'Interview', 'Offer', 'Rejected'].includes(r.Status)),
  interviewsTotal: count((r) => ['Interview', 'Offer'].includes(r.Status)),
  byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '),
  bestCompanies: [...new Set(best.slice(0, 8).map((r) => r.Company))].join(', '),
  jobsText: best.map((r) => `- ${r.Role} at ${r.Company} (${r.Country}, fit ${r['Fit Score']}). Gaps: ${r.Gaps || 'none'}. Why: ${r['Why It Fits'] || ''}`).join('\n'),
  nothing: week.length === 0,
} }];
