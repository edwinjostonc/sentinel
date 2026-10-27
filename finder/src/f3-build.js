// Weekly tab row and summary email.
const s = $('Weekly Numbers').first().json;
const c = $('Config').first().json;
let a = {};
try { a = $('AI: Weekly Insights').first().json.output || {}; } catch (e) { /* no AI this week */ }
const list = (x) => (Array.isArray(x) ? x : String(x || '').split(/\s*\|\s*/)).filter(Boolean);
const row = { 'Week': s.weekOf, 'Jobs Found': s.found, 'Strong (75+)': s.strong, 'Applied (total)': s.appliedTotal, 'Interviews (total)': s.interviewsTotal,
  'By Country': s.byCountry, 'Top Skills Asked': list(a.top_skills).join(', '), 'Your Top Gaps': list(a.top_gaps).join(', '),
  'Learn Next': list(a.learn_next).join(' | '), 'Best Companies': s.bestCompanies };
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2>Your job search this week</h2>
<p><b>${s.found}</b> new jobs found (<b>${s.strong}</b> strong matches). Applied so far: <b>${s.appliedTotal}</b>, interviews: <b>${s.interviewsTotal}</b>.</p>
<p><b>Where:</b> ${esc(s.byCountry)}</p>
${row['Top Skills Asked'] ? `<p><b>Skills employers asked for most:</b> ${esc(row['Top Skills Asked'])}</p>` : ''}
${row['Your Top Gaps'] ? `<p><b>Your most common gaps:</b> ${esc(row['Your Top Gaps'])}</p>` : ''}
${list(a.learn_next).length ? `<p><b>Learn next:</b></p><ul>${list(a.learn_next).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${a.advice ? `<p><b>Tip:</b> ${esc(a.advice)}</p>` : ''}
<p><a href="https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit">Open your Job Tracker</a></p></div>`;
return [{ json: { row, to: c.digestEmail, subject: `Weekly job search summary – ${s.found} jobs, ${s.strong} strong`, html } }];
