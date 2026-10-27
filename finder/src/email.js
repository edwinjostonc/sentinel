// Daily job email (n8n Code node "Digest Email"). Greeting, footer and visa line come from the profile's Config.
// All new jobs, best match first, max 25, an "Apply today" top 5 (rolls over 14 days) and follow-up reminders. Always sends something, so they know it ran.
const c = $('Config').first().json;
if (!c.digestEmail) return [];
// job text comes from job boards and the sheet (which people edit): escape everything, quotes too, and only link to http(s)
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const href = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');
const hi = (s) => (c.emailGreeting ? c.emailGreeting + s.charAt(0).toLowerCase() + s.slice(1) : s);
const VISA_COUNTRY = { uk: 'UK', nl: 'Netherlands' };
const visaCountries = (c.visaChecks || []).map((v) => VISA_COUNTRY[v]).filter(Boolean);
const rows = $input.all().map((i) => i.json).filter((r) => r && r.link);
const jobs = rows.filter((r) => r.keep).sort((a, b) => b.fit - a.fit);
const shown = jobs.slice(0, 25);
const notScored = rows.filter((r) => !r.scored && !r.skipReason).length;   // AI busy: these are tried again tomorrow
const day = $now.toFormat('cccc d LLLL');
const sheetUrl = 'https://docs.google.com/spreadsheets/d/__SHEET_ID__/edit';
// applied 7+ days ago, flagged "Due" by the daily sheet check
const followUps = $('Get Jobs Already Logged').all().map((i) => i.json).filter((r) => r && r.Status === 'Applied' && /^due/i.test(String(r['Follow-up'] || '')));
const followHtml = followUps.length ? `<h3 style="margin:18px 0 6px">Time to follow up</h3><p style="font-size:13px;margin:0 0 6px">You applied 7+ days ago - a short, friendly email to the company can help.</p>
  <ul>${followUps.map((r) => `<li><a href="${href(r['Job Link'])}">${esc(r.Role)}</a> - ${esc(r.Company)} (applied ${esc(r['Applied On'])})</li>`).join('')}</ul>
  <p style="font-size:12px;color:#5f6368">After following up, set "Follow-up" to Done in your job list.</p>` : '';
const color = (f) => (f >= 75 ? '#1e8e3e' : f >= 55 ? '#188038' : '#b06000');
const card = (r) => `
  <div style="border:1px solid #e0e0e0;border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <div style="font-size:17px;font-weight:600">${esc(r.title)}</div>
    <div style="font-size:14px;color:#3c4043;margin:2px 0 6px">${esc(r.company)} · ${esc(r.location || r.country)}${r.workMode ? ' · ' + esc(r.workMode) : ''}</div>
    <div style="font-size:14px"><b style="color:${color(r.fit)}">Match ${Number(r.fit) || 0}/100 (${esc(r.verdict)})</b></div>
    ${(r.flags || []).length ? `<div style="font-size:12px;margin-top:4px;color:#b06000">${r.flags.map(esc).join(' · ')}</div>` : ''}
    ${r.why ? `<div style="font-size:13px;margin-top:6px">${esc(r.why)}</div>` : ''}
    ${r.salaryText ? `<div style="font-size:13px;margin-top:4px"><b>Salary:</b> ${esc(r.salaryText)}${r.salary2 ? ` (≈ ${esc(r.salary2)} per year)` : ''}</div>` : ''}
    ${visaCountries.includes(r.country) && r.visa ? `<div style="font-size:13px;margin-top:4px"><b>Visa:</b> ${esc(r.visa)}</div>` : ''}
    ${r.language && !/not mentioned|english only/i.test(r.language) ? `<div style="font-size:13px;margin-top:4px"><b>Language:</b> ${esc(r.language)}</div>` : ''}
    ${r.resumeChanges ? `<div style="font-size:13px;margin-top:6px"><b>Tip for your CV:</b><br>${esc(r.resumeChanges).replace(/\n/g, '<br>')}</div>` : ''}
    <div style="margin-top:10px"><a href="${href(r.link)}" style="background:#1a73e8;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:14px">Apply</a></div>
  </div>`;
let subject, body;
if (shown.length) {
  subject = `Your job list for ${day}: ${jobs.length} new job${jobs.length === 1 ? '' : 's'}`;
  body = `<p>${hi('Here are today\'s new jobs, best match first. Click <b>Apply</b> to open the job.')}</p>
  ${shown.map(card).join('')}
  ${jobs.length > shown.length ? `<p style="color:#5f6368">…and ${jobs.length - shown.length} more with a lower match (not shown).</p>` : ''}`;
} else if (notScored) {
  subject = `Your job list for ${day} is delayed`;
  body = `<p>${hi('Today\'s jobs could not be checked yet (the AI was busy). They will be in tomorrow\'s email.')}</p>`;
} else {
  subject = `No new jobs today (${day})`;
  body = `<p>${hi('No new matching jobs today. The next list comes tomorrow morning.')}</p>`;
}
// "Apply today": best 5 not-yet-applied jobs from today plus the last 14 days (Status still "To apply")
const since = $now.minus({ days: 14 }).toFormat('yyyy-MM-dd');
const earlier = $('Get Jobs Already Logged').all().map((i) => i.json)
  .filter((r) => r && r['Job Link'] && (r.Status || 'To apply') === 'To apply' && String(r['Date Found'] || '') >= since)
  .map((r) => ({ title: r.Role, company: r.Company, country: r.Country, fit: Number(r['Fit Score']) || 0, link: r['Job Link'], visa: r['Visa / Sponsor'], found: r['Date Found'],
    shortAd: /Short ad/.test(r.Notes || '') }));
// jobs scored from a full ad first: a snippet-only score is a guess, so those only fill up the remaining places
const top = [...jobs, ...earlier].filter((r, i, all) => all.findIndex((x) => x.link === r.link) === i)
  .sort((a, b) => Number(Boolean(a.shortAd)) - Number(Boolean(b.shortAd)) || b.fit - a.fit).slice(0, 5);
const topHtml = top.length ? `<div style="background:#e8f0fe;border-radius:10px;padding:12px 16px;margin:0 0 16px">
  <div style="font-size:16px;font-weight:600;margin-bottom:6px">Apply today: your top ${top.length}</div>
  <ol style="margin:0;padding-left:20px">${top.map((r) => `<li style="margin:4px 0;font-size:14px"><a href="${href(r.link)}">${esc(r.title)}</a> - ${esc(r.company)} (${esc(r.country)}) · <b style="color:${color(r.fit)}">${Number(r.fit) || 0}</b>${r.found ? ` <span style="color:#5f6368;font-size:12px">· from ${esc(r.found)}</span>` : ''}${visaCountries.includes(r.country) && /^Yes/.test(r.visa || '') ? ' <span style="color:#1e8e3e;font-size:12px">· sponsor</span>' : ''}${r.shortAd ? ' <span style="color:#b06000;font-size:12px">· short ad</span>' : ''}</li>`).join('')}</ol>
  <div style="font-size:12px;color:#5f6368;margin-top:6px">Jobs you don't apply to stay here until a better one comes or 14 days pass. Set Status to "Applied" or "Not for me" in the sheet to take one off.</div></div>` : '';
// first thing in the email: mark applications in the sheet (follow-up reminders and the weekly numbers depend on it)
const marked = $('Get Jobs Already Logged').all().map((i) => i.json).filter((r) => r && ['Applied', 'Interview', 'Offer', 'Rejected'].includes(r.Status)).length;
const markHtml = `<div style="border:2px solid #f9ab00;background:#fef7e0;border-radius:10px;padding:12px 16px;margin:0 0 16px">
  <div style="font-size:15px;font-weight:600">${marked ? `${marked} application${marked > 1 ? 's' : ''} marked so far. Applied to more?` : 'Applied to any jobs? Your sheet shows none yet.'}</div>
  <div style="font-size:13px;margin-top:4px">Open <a href="${sheetUrl}">your job list</a>, find the job (also ones from earlier emails) and set its <b>Status</b> to <b>Applied</b>. Then you get a follow-up reminder after 7 days. Interview or offer? Set that Status too.</div></div>`;
const tracker = `<p style="font-size:13px;margin-top:16px"><b>Your job list:</b> <a href="${sheetUrl}">open the sheet</a> - after applying, set the job's Status to "Applied". It reminds you to follow up after 7 days.</p>`;
const html = `<div style="font-family:Arial,sans-serif;max-width:640px">${markHtml}${topHtml}${body}${followHtml}${tracker}
  <p style="font-size:12px;color:#5f6368;margin-top:18px">${esc(c.emailFooter || 'Sent every morning by your job finder.')}</p></div>`;
return [{ json: { to: c.digestEmail, subject, html } }];
