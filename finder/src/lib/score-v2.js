// v2 scoring rules, inlined into Local Results and Gemini Results by build-workflows.js.
// The AI scores four rubric parts; the fit score is their sum, computed here, capped when a hard blocker applies.
// A blocker the AI claims only counts if its quote is really in the job's title/ad. Location of non-remote jobs is
// left to the code (the AI tends to quote the job's own city as a "blocker"). Blockers the code found always apply.
const BLOCKERS = ['language', 'location', 'eligibility', 'seniority', 'profession'];
const PARTS = { skills: 40, experience: 25, domain: 15, must_haves: 20 };
const BLOCKED_MAX = 45;
const NO_EVIDENCE_MAX = 60; // nothing in MY RESUME matches the ad: at most "maybe", never "apply"
const LANGUAGE_RISK_MAX = 69; // local language likely needed but not proven (job.langRisk from Make Batches): at most "maybe"
const noEvidence = (s) => /^\s*(none|n\/a)?\W*$/i.test(String(s ?? ''));
const words = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
function quoteFound(quote, job, blocker) {
  const q = words(quote).filter((w) => w.length > 2);
  if (!q.length || /^none$/i.test(String(quote || '').trim())) return false;
  const have = new Set(words(blocker === 'location' ? job.ad : job.title + ' ' + job.ad));
  return q.filter((w) => have.has(w)).length / q.length >= 0.8;
}
// raw = one job from the AI's answer; job = { id, title, ad, remote, langRisk, blockers } from Make Batches
function finish(raw, job) {
  const parts = Object.fromEntries(Object.entries(PARTS).map(([k, max]) => [k, Math.max(0, Math.min(max, Math.round(Number(raw[k]) || 0)))]));
  const claimed = [...new Set((raw.blockers || []).filter((b) => BLOCKERS.includes(b)))];
  const kept = claimed.filter((b) => (b !== 'location' || job.remote) && quoteFound(raw.blocker_quote, job, b));
  const blockers = [...new Set([...kept, ...job.blockers])];
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  // soft caps (not blockers): the job can still show up as "maybe"
  const caps = [noEvidence(raw.evidence) && NO_EVIDENCE_MAX, job.langRisk && LANGUAGE_RISK_MAX, blockers.length && BLOCKED_MAX].filter(Boolean);
  return { id: job.id, fit_score: Math.min(sum, ...caps), parts, blockers,
    why: raw.why, gaps: raw.gaps, resume_changes: raw.resume_changes, visa_note: raw.visa_note, language_note: raw.language_note };
}
// several answers for the same job -> the one with the median score (so its why/gaps match the score)
function median(answers) {
  const xs = [...answers].sort((a, b) => a.fit_score - b.fit_score);
  return { ...xs[(xs.length - 1) >> 1], samples: xs.map((x) => x.fit_score) };
}
// job info by id, from the Make Batches items
const jobsById = () => Object.fromEntries($('Make Batches').all().flatMap((i) => i.json.jobs || []).map((j) => [j.id, j]));
