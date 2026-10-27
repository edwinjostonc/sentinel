// Stronger model's answers -> scores (same rules as the first pass, lib/score-v2.js). Build Rows prefers these.
//@include lib/score-v2.js
const byJob = jobsById();
const results = $input.all().flatMap((i) => ((i.json.output || {}).results || []))
  .map((raw) => [raw, byJob[String((raw && raw.id) || '').trim().toUpperCase()]]).filter(([, job]) => job).map(([raw, job]) => finish(raw, job));
return [{ json: { results } }];
