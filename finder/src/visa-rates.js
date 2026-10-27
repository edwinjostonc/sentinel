// Sponsor registers for the profile's visaChecks (UK Home Office Skilled Worker list, Dutch IND recognised sponsors),
// plus today's EUR exchange rates. A register that cannot be read today leaves the visa column to the AI's reading of the ad.
const checks = $('Config').first().json.visaChecks || [];
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36' };
const jobs = $input.all().map((i) => i.json);
const sponsors = {};   // job id -> visa text
const registers = {};  // register -> number of names read (0 = not available today)

// exact name first, then a prefix match for names of 6+ characters ("Monzo Bank" ~ "Monzo")
function match(list, jobsHere, norm, yes, no) {
  const names = new Map();
  for (const n of list) { const k = norm(n).trim(); if (k.length >= 3 && !names.has(k)) names.set(k, n); }
  const keys = [...names.keys()];
  for (const j of jobsHere) {
    const c = norm(j.company).trim();
    const hit = c.length >= 3 && (names.has(c) ? c : c.length >= 6 && keys.find((n) => n.length >= 6 && (n.startsWith(c) || c.startsWith(n))));
    sponsors[j.id] = hit ? `${yes} (${names.get(hit)})` : no;
  }
}

const uk = jobs.filter((x) => x.country === 'UK');
if (checks.includes('uk') && uk.length) {
  try {
    // the CSV link changes with every daily update: find it on the register page
    const page = String(await this.helpers.httpRequest({ url: 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers', headers: UA, timeout: 60000 }));
    const url = (page.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.csv/) || [])[0];
    const csv = url ? String(await this.helpers.httpRequest({ url, headers: UA, timeout: 120000 })) : '';
    // columns: Organisation Name, Town/City, County, Type & Rating, Route; only the Skilled Worker route matters
    const list = csv.split(/\r?\n/).filter((l) => l.includes('Skilled Worker'))
      .map((l) => (l.startsWith('"') ? l.slice(1, l.indexOf('"', 1)) : l.slice(0, l.indexOf(','))).trim());
    registers.uk = list.length;
    // "Monzo Bank Ltd" = "Monzo", "Oxford University Hospitals NHS Trust" = "... NHS Foundation Trust"
    const norm = (s) => ' ' + String(s || '').toLowerCase()
      .replace(/\b(limited|ltd|plc|llp|uk|u\.k\.|group|holdings?|international|services|the|gmbh|inc|and|nhs|foundation|trust|bank|financial|technology|technologies)\b/g, ' ')
      .replace(/[^\p{L}\p{N}]/gu, '') + ' ';
    if (list.length > 10000) match(list, uk, norm, 'Yes – UK licensed sponsor', 'Not on UK sponsor list');
  } catch (e) { registers.uk = 0; }
}

const nl = jobs.filter((x) => x.country === 'Netherlands');
if (checks.includes('nl') && nl.length) {
  try {
    const html = String(await this.helpers.httpRequest({ url: 'https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants', headers: UA, timeout: 60000 }));
    // company names are the <th scope="row"> cells
    const list = [...html.matchAll(/<th scope="row"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim()).filter(Boolean);
    registers.nl = list.length;
    const norm = (s) => ' ' + String(s || '').toLowerCase()
      .replace(/\b(b\.?v\.?|n\.?v\.?|holding|nederland|netherlands|the netherlands|europe|benelux|international|group|groep|limited|ltd|gmbh)\b/g, ' ')
      .replace(/[^\p{L}\p{N}]/gu, '') + ' ';
    if (list.length > 1000) match(list, nl, norm, 'Yes – IND sponsor', 'Not on IND sponsor list');
  } catch (e) { registers.nl = 0; }
}

let fx = null;
try { const r = await this.helpers.httpRequest({ url: 'https://open.er-api.com/v6/latest/EUR', json: true, timeout: 20000 }); if (r && r.rates) fx = r.rates; } catch (e) { /* salaries shown as given */ }
return [{ json: { sponsors, fx, registers } }];
