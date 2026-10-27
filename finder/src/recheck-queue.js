// Second check of the best jobs: Flash-Lite scored everything; jobs at recheck.minScore or above are scored again by a
// stronger model with a longer piece of the ad (the top 5 in the email is what people apply to, so that is where accuracy matters).
// Returns { nothing: true } when no job qualifies, so the IF node after it can go straight to Build Rows.
// The longer ad goes through aiSafe too: it is job-board text, not instructions.
//@include lib/common.js
const rc = CFG.recheck || {};
const first = ($('Gemini Results').first().json.results || []).filter((r) => r.fit_score >= (rc.minScore || 65))
  .sort((a, b) => b.fit_score - a.fit_score).slice(0, rc.maxJobs || 15);
if (!first.length) return [{ json: { nothing: true } }];
const squeeze = (t) => String(t || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
const details = $('Get Job Details').all().map((i) => i.json);
// the job blocks Make Batches wrote for the first pass, with the ad text swapped for a longer version
const blocks = {};
for (const { json: b } of $('Make Batches').all()) {
  for (const part of String(b.jobsText || '').split(/\n\n(?=### JOB )/)) {
    const id = (part.match(/^### JOB (J\d+)/) || [])[1];
    const full = id && aiSafe(squeeze((details[Number(id.slice(1)) - 1] || {}).description).slice(0, 4000));
    if (id) blocks[id] = full ? part.replace(/\nAd text: [\s\S]*?\nNotes: /, () => `\nAd text: ${full}\nNotes: `) : part;
  }
}
const base = $('Make Batches').first().json;
const size = Math.max(1, rc.jobsPerCall || 5);
const out = [];
for (let i = 0; i < first.length; i += size) {
  const ids = first.slice(i, i + size).map((r) => r.id).filter((id) => blocks[id]);
  if (ids.length) out.push({ json: { resume: base.resume, about: base.about, jobsText: ids.map((id) => blocks[id]).join('\n\n'), ids } });
}
return out.length ? out : [{ json: { nothing: true } }];
