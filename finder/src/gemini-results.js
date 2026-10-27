// Gemini answers -> scores (rules in lib/score-v2.js).
//@include lib/score-v2.js
const byJob = jobsById();
const results = $input.all().flatMap((i) => ((i.json.output || {}).results || []))
  .map((raw) => [raw, byJob[String((raw && raw.id) || '').trim().toUpperCase()]]).filter(([, job]) => job).map(([raw, job]) => finish(raw, job));
return [{ json: { results } }];
