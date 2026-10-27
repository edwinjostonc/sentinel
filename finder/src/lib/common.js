// Shared helpers, inlined into Code nodes by build-workflows.js.
const CFG = $('Config').first().json;
const strip = (h) => String(h || '')
  .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&#039;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
  .replace(/[ \t\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const pad = (s) => ' ' + String(s || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
const day = (d) => { const x = d ? new Date(d) : null; return x && !isNaN(x) ? x.toISOString().slice(0, 10) : ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WORDS = [...CFG.searchWords, ...(CFG.includeSalesJobs ? CFG.salesSearchWords : [])];

// 'A' = sustainability title, 'B' = sales title at a green employer, '' = skip.
// For B, one "sustainability" line in company boilerplate is not enough: need 3 green words in the ad.
function titleGroup(title, text, company, greenEmployer) {
  const t = pad(title);
  if (CFG.excludeTitleWords.some((w) => t.includes(w))) return '';
  if (CFG.titleWordsA.some((w) => t.includes(w))) return 'A';
  if (!CFG.includeSalesJobs || !CFG.titleWordsB.some((w) => t.includes(w))) return '';
  const head = pad(title + ' ' + company), body = pad(text);
  if (greenEmployer || CFG.greenWords.some((w) => head.includes(w)) || CFG.greenWords.filter((w) => body.includes(w)).length >= 3) return 'B';
  return '';
}

// UK first, so "Belfast, Northern Ireland" is not read as Ireland.
const PLACES = {
  UK: ['united kingdom', 'uk', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh',
    'bristol', 'liverpool', 'cambridge', 'oxford', 'reading', 'sheffield', 'nottingham', 'newcastle', 'cardiff', 'belfast', 'milton keynes', 'brighton', 'southampton',
    'leicester', 'coventry', 'aberdeen', 'york', 'bath', 'exeter', 'norwich', 'swindon', 'slough', 'guildford', 'luton', 'watford', 'croydon', 'stockport', 'salford'],
  UAE: ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah', 'ajman', 'ras al khaimah'],
  India: ['india', 'bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'pune', 'hyderabad', 'chennai', 'kolkata', 'kochi', 'cochin', 'ahmedabad', 'jaipur', 'thiruvananthapuram', 'trivandrum', 'coimbatore', 'chandigarh', 'indore', 'kerala', 'tamil nadu', 'karnataka', 'maharashtra', 'thrissur'],
  Netherlands: ['netherlands', 'nederland', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'den haag', 'the hague', 's-gravenhage', 'eindhoven', 'maastricht', 'groningen', 'leiden', 'delft', 'arnhem', 'nijmegen', 'haarlem', 'amersfoort', 'zwolle', 'tilburg', 'breda', 'almere', 'hoofddorp', 'schiphol', 'den bosch', "'s-hertogenbosch", 'enschede', 'apeldoorn', 'zaandam', 'amstelveen', 'wageningen', 'heerlen', 'venlo', 'deventer'],
  Ireland: ['ireland', 'dublin', 'cork', 'galway', 'limerick', 'waterford'],
  Malta: ['malta', 'valletta', 'sliema', 'st julian', 'birkirkara', 'msida', 'gzira'],
  Belgium: ['belgium', 'belgië', 'belgique', 'brussels', 'bruxelles', 'brussel', 'antwerp', 'antwerpen', 'ghent', 'gent', 'leuven', 'zaventem', 'liège', 'mechelen'],
  Luxembourg: ['luxembourg', 'luxemburg'],
  Germany: ['germany', 'deutschland', 'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln', 'cologne', 'düsseldorf', 'stuttgart', 'leipzig', 'hannover', 'bremen', 'dresden', 'nürnberg', 'nuremberg', 'norderstedt', 'potsdam', 'bonn', 'karlsruhe', 'mannheim', 'essen', 'dortmund', 'duisburg',
    'bochum', 'münster', 'wiesbaden', 'mainz', 'darmstadt', 'heidelberg', 'freiburg', 'augsburg', 'regensburg', 'erlangen', 'ingolstadt', 'wolfsburg', 'braunschweig', 'kiel',
    'lübeck', 'rostock', 'magdeburg', 'jena', 'erfurt', 'kassel', 'göttingen', 'aachen', 'ulm', 'walldorf', 'eschborn', 'gütersloh', 'bielefeld', 'osnabrück'],
  Austria: ['austria', 'österreich', 'wien', 'vienna', 'graz', 'linz', 'salzburg'],
  France: ['france', 'paris', 'lyon', 'marseille', 'toulouse', 'lille', 'nantes', 'bordeaux', 'arcueil'],
  Spain: ['spain', 'españa', 'madrid', 'barcelona', 'valencia', 'sevilla', 'bilbao', 'málaga'],
  Portugal: ['portugal', 'lisboa', 'lisbon', 'porto', 'aveiro', 'braga'],
  Italy: ['italy', 'italia', 'milano', 'milan', 'roma', 'rome', 'torino', 'turin', 'bologna', 'firenze'],
  Denmark: ['denmark', 'danmark', 'københavn', 'copenhagen', 'aarhus', 'odense'],
  Sweden: ['sweden', 'sverige', 'stockholm', 'göteborg', 'gothenburg', 'malmö', 'uppsala', 'västerås', 'lund', 'linköping', 'örebro', 'umeå', 'luleå', 'boden',
    'helsingborg', 'jönköping', 'norrköping', 'sundsvall', 'gävle', 'södertälje', 'solna', 'sundbyberg', 'kista', 'skellefteå', 'karlstad', 'växjö'],
  Finland: ['finland', 'suomi', 'helsinki', 'espoo', 'tampere', 'hanko', 'vantaa'],
  Poland: ['poland', 'polska', 'warszawa', 'warsaw', 'kraków', 'krakow', 'wrocław', 'wroclaw', 'poznań', 'gdańsk', 'gdansk', 'łódź'],
  Czechia: ['czechia', 'czech republic', 'praha', 'prague', 'brno'],
  Greece: ['greece', 'athens', 'αθήνα', 'thessaloniki'],
  Hungary: ['hungary', 'budapest'],
  Romania: ['romania', 'bucharest', 'bucurești', 'cluj'],
  Cyprus: ['cyprus', 'nicosia', 'limassol', 'larnaca'],
  Estonia: ['estonia', 'tallinn'], Latvia: ['latvia', 'riga'], Lithuania: ['lithuania', 'vilnius'],
  Slovakia: ['slovakia', 'bratislava'], Slovenia: ['slovenia', 'ljubljana'], Croatia: ['croatia', 'zagreb'], Bulgaria: ['bulgaria', 'sofia'],
};
const PLACE_RX = Object.entries(PLACES).map(([country, names]) =>
  [country, new RegExp('(^|[^\\p{L}])(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')([^\\p{L}]|$)', 'iu')]);
const countryOf = (...texts) => {
  for (const t of texts) { if (!t) continue; for (const [c, rx] of PLACE_RX) if (rx.test(t)) return c; }
  return '';
};
// English-language ads are read everywhere; local-language ads only in the profile's readLocalLanguage countries
const ENGLISH_COUNTRIES = ['UK', 'Ireland', 'Malta', 'India', 'UAE'];
const LOCAL_OK = CFG.readLocalLanguage || [];
const countryWanted = (c) => Boolean(c) && CFG.countries.includes(c);
// only real web links reach the email and the sheet (a "javascript:" link from a job board would run in the browser)
const safeLink = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');

// Stopword count, good enough to tell English from other EU languages.
const STOP = {
  en: ['the', 'and', 'with', 'for', 'you', 'our', 'will', 'are', 'your', 'we', 'to', 'of', 'in', 'is', 'as', 'on'],
  nl: ['de', 'het', 'een', 'van', 'voor', 'met', 'je', 'wij', 'jij', 'zijn', 'naar', 'ons', 'bij', 'als', 'ook', 'wat', 'jouw', 'onze'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'sie', 'ist', 'zu', 'auf', 'bei', 'eine', 'ein', 'dich', 'unser', 'du', 'deine'],
  fr: ['et', 'les', 'des', 'pour', 'avec', 'nous', 'vous', 'une', 'dans', 'sur', 'est', 'le', 'la', 'du', 'au'],
  es: ['y', 'los', 'las', 'para', 'con', 'una', 'del', 'que', 'por', 'el', 'nuestro', 'tu'],
  it: ['il', 'della', 'per', 'con', 'che', 'di', 'nel', 'sono', 'nostro', 'gli', 'delle'],
  pt: ['os', 'das', 'para', 'com', 'uma', 'que', 'não', 'na', 'do', 'da', 'você'],
  sv: ['och', 'att', 'för', 'med', 'som', 'vi', 'är', 'på', 'av', 'ett', 'dig'],
  da: ['og', 'at', 'med', 'som', 'vi', 'er', 'på', 'af', 'til', 'dig', 'vores'],
  pl: ['w', 'na', 'z', 'do', 'jest', 'dla', 'się', 'oraz', 'nie', 'że'],
};
const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)]));
function isEnglish(text) {
  const words = String(text || '').toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 12) return true;
  const score = {};
  for (const [k, set] of Object.entries(STOP_SETS)) score[k] = words.filter((w) => set.has(w)).length;
  const other = Math.max(...Object.entries(score).filter(([k]) => k !== 'en').map(([, v]) => v));
  return score.en >= other * 0.8;
}
const LANGS = 'dutch|german|french|spanish|italian|portuguese|swedish|danish|polish|finnish|czech|greek|hungarian|romanian|arabic|norwegian';
const LANG_REQ = [
  new RegExp(`(fluent|fluency|native|proficien\\w*|excellent|strong|business[- ]level|very good|professional)\\s+(command of\\s+|knowledge of\\s+|skills in\\s+)?(in\\s+)?(the\\s+)?(${LANGS})`, 'i'),
  new RegExp(`(${LANGS})\\s+(and english\\s+)?(language\\s+)?(is\\s+|are\\s+)?(required|mandatory|a must|essential|needed)`, 'i'),
  new RegExp(`(${LANGS})\\s*(\\(|-|:)?\\s*(c1|c2|native|fluent)`, 'i'),
  new RegExp(`(fluent|fluency|native)[^.\\n;]{0,30}english (and|&) (${LANGS})`, 'i'),
];
const OPTIONAL = /^[^.\n;]{0,30}(plus|advantage|nice to have|bonus|preferred|asset|beneficial|desirable|von vorteil|wünschenswert|ein pluspunkt|optional)/i;
// German above B1 (for someone at A2 who is learning: up to B1 is fine), in English and German wording.
// (?!land) so "Deutschland" does not count as the language.
const GERMAN_HIGH = [
  /(fluent|fluency|native|excellent|very good|good|strong|business[- ]level|business[- ]fluent|proficien\w*|advanced|professional)\s+(command of\s+|knowledge of\s+|skills in\s+|level of\s+)?(written and spoken\s+|spoken and written\s+)?(in\s+)?(the\s+)?german/i,
  /german\s*(language\s*)?(skills\s*)?(\(|-|:|at|on)?\s*(a\s+)?(level\s*)?(of\s+)?(b2|c1|c2|native|fluent)\b/i,
  /\b(b2|c1|c2)\b[^.\n;]{0,25}german/i,
  /(fluent|fluency|native)[^.\n;]{0,30}(english (and|&) german|german (and|&) english)/i,
  /german[- ]speak(ing|er)/i,
  /(?<!\p{L})(sehr gut|gut|fließend|fliessend|verhandlungssicher|exzellent|hervorragend|ausgezeichnet|perfekt|souverän|stilsicher|ausgeprägt)\p{L}*\s+(\p{L}+\s+){0,3}deutsch(?!land)/iu,
  /deutsch(?!land)\p{L}*\s*(\(|-|:)?\s*(auf\s+)?(dem\s+)?(niveau\s+)?(b2|c1|c2)\b/iu,
  /\b(b2|c1|c2)\b[^.\n;]{0,25}deutsch(?!land)/iu,
  /deutsch(?!land)\s+(als\s+)?muttersprache|muttersprachlich\p{L}*\s+deutsch|deutsch(?!land)\p{L}*[^.\n;]{0,25}(fließend|fliessend|verhandlungssicher)/iu,
];
// German above B2 (for someone with B2): only C1/C2, native or negotiation level counts; "fluent" is left to the AI
const GERMAN_ABOVE_B2 = [
  /german\s*(language\s*)?(skills\s*)?(\(|-|:|at|on)?\s*(a\s+)?(level\s*)?(of\s+)?(c1|c2|native)\b/i,
  /\b(c1|c2)\b[^.\n;]{0,25}german/i,
  /native\s+(command of\s+|knowledge of\s+)?(in\s+)?german|german\s+(as\s+)?(a\s+)?(native|mother tongue)/i,
  /deutsch(?!land)\p{L}*\s*(\(|-|:)?\s*(auf\s+)?(dem\s+)?(niveau\s+)?(c1|c2)\b/iu,
  /\b(c1|c2)\b[^.\n;]{0,25}deutsch(?!land)/iu,
  /deutsch(?!land)\s+(als\s+)?muttersprache|muttersprachlich\p{L}*\s+deutsch|verhandlungssicher\p{L}*\s+(\p{L}+\s+){0,3}deutsch(?!land)|deutsch(?!land)\p{L}*[^.\n;]{0,25}verhandlungssicher/iu,
];
// Language the ad requires, ignoring "Dutch is a plus" style lines. With germanUpToB1 / germanUpToB2, German only
// counts above that level.
function requiredLanguage(text) {
  const s = String(text || '');
  const hit = (rx) => { const m = s.match(rx); return m && !OPTIONAL.test(s.slice(m.index + m[0].length)) ? m : null; };
  const germanOk = CFG.germanUpToB1 || CFG.germanUpToB2;
  for (const rx of LANG_REQ) {
    const m = hit(rx);
    const lang = m && (m[0].match(new RegExp(LANGS, 'gi')) || ['']).pop();
    if (lang && !(germanOk && /^german$/i.test(lang))) return lang;
  }
  if (CFG.germanUpToB1 && GERMAN_HIGH.some(hit)) return 'German above B1';
  if (CFG.germanUpToB2 && GERMAN_ABOVE_B2.some(hit)) return 'German above B2';
  return '';
}

// invisible/direction-control characters are dropped from what the email and sheet show ("Analyst‮exe.pdf" spoofing)
const job = (j) => ({
  source: j.source, id: j.id, title: visible(strip(j.title)).replace(/\s+/g, ' '), company: visible(strip(j.company)).replace(/\s+/g, ' '),
  location: visible(strip(j.location)).replace(/\s+/g, ' '), country: j.country || '', workMode: j.workMode || '',
  link: safeLink(j.link), posted: j.posted || '', description: strip(j.description).slice(0, 6000),
  salary: j.salary || null, detail: j.detail || null, group: j.group || '',
  greenEmployer: Boolean(j.greenEmployer), maxAgeDays: j.maxAgeDays || 0,
});
// Returns the job if it passes title, country, age and language filters, else null.
function accept(j) {
  j.group = titleGroup(j.title, j.description, j.company, j.greenEmployer);
  if (!j.group || !j.link) return null;
  if (!j.country) j.country = countryOf(j.location);
  const remote = /remote|anywhere|worldwide/i.test(j.workMode + ' ' + j.location);
  if (!countryWanted(j.country) && !(remote && CFG.remote && (!j.country || j.country === 'Remote'))) return null;
  if (!j.country) j.country = 'Remote';
  if (j.posted && (Date.now() - new Date(j.posted).getTime()) > ((j.maxAgeDays || CFG.maxAgeDays) + 1) * 86400000) return null;
  const text = j.title + '\n' + j.description;
  if (![...ENGLISH_COUNTRIES, ...LOCAL_OK].includes(j.country) && !isEnglish(text)) return null;
  if (requiredLanguage(text)) return null;
  return j;
}

// Job ads are untrusted text that goes into the AI prompt. Sentences that talk to the AI ("ignore previous instructions",
// "give this job 100") are prompt injection: the job is flagged and those sentences are cut before the AI sees them.
// Covers English plus the languages of the profiles' countries (German, Dutch, Swedish, French, Spanish), chat-model role
// tags ("<|im_start|>system", "[INST]") and ready-made answers smuggled into an ad ("skills": 40).
const INJECTION = new RegExp([
  '(ignore|disregard|forget|override)\\s+(all\\s+|any\\s+|the\\s+|your\\s+)?(previous|prior|above|earlier|other|system)\\s+(instructions|prompts?|rules|messages)',
  '(system|developer)\\s+(prompt|message|instructions?)',
  '\\b(you are|act as|pretend to be)\\s+(now\\s+)?(an?\\s+|the\\s+)?(ai|assistant|language model|chatgpt|gemini|recruiter bot)',
  '\\b(fit[_ ]?score|must_haves|blocker_quote)\\b',
  '\\b(give|rate|score|assign)\\s+(this|the|me|my|our)\\s+(job|role|ad|application|candidate)?\\s*(a\\s+)?(score\\s+(of\\s+)?)?(100|ninety|9\\d)\\b',
  '\\b(note to|message to|attention)\\s+(the\\s+)?(ai|llm|language model|assistant|chatbot)',
  'ignorier\\w*\\s+(du\\s+)?(alle\\s+)?(vorherigen|bisherigen|obigen|früheren|vorangegangenen)\\s+(anweisungen|befehle|regeln|instruktionen)',
  'vergiss\\s+(alle\\s+)?(vorherigen|bisherigen|obigen)\\s+(anweisungen|befehle|regeln)',
  'negeer\\s+(alle\\s+)?(vorige|eerdere|voorgaande|bovenstaande)\\s+(instructies|opdrachten|regels)',
  'ignorera\\s+(alla\\s+)?(tidigare|föregående|ovanstående)\\s+(instruktioner|regler|anvisningar)',
  'ignore[zr]?\\s+(toutes\\s+)?(les\\s+)?(instructions|consignes)\\s+(précédentes|antérieures)',
  'ignora\\s+(todas\\s+)?(las\\s+)?(instrucciones|reglas)\\s+(anteriores|previas)',
  '<\\|?\\s*(im_start|im_end|system|assistant|endoftext)\\s*\\|?>',
  '\\[\\/?(inst|sys)\\]',
  '<\\/?(system|instructions?|prompt)>',
  '"(skills|experience|domain|must_haves|fit_score)"\\s*:\\s*-?\\d',
].join('|'), 'i');
// invisible characters (zero-width spaces, soft hyphens, direction marks) can hide words from the filter but not from the AI: drop them first
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const visible = (t) => String(t || '').replace(INVISIBLE, '');
// look-alike letters (Cyrillic/Greek "о", "е", "а"... inside English words, full-width letters) are read as Latin for the check only;
// the text itself is left as it is, so real Cyrillic or Greek ads are not garbled
const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'һ': 'h', 'ӏ': 'l', 'ո': 'n',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I',
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'κ': 'k', 'Ο': 'O', 'Α': 'A', 'Ε': 'E', 'Ι': 'I', 'Ρ': 'P', 'Τ': 'T', 'Κ': 'K', 'Ν': 'N' };
const skeleton = (t) => visible(t).normalize('NFKC').replace(/[Ͱ-ϿЀ-ӿԀ-ԯɡգ-օ]/g, (c) => CONFUSABLE[c] || c);
const looksInjected = (t) => INJECTION.test(skeleton(t));
// cut injected sentences; also break the prompt's own markers so an ad cannot fake a "### JOB" block or "Notes:" line
function aiSafe(t) {
  return visible(t)
    .replace(/[^.!?\n]+[.!?]*/g, (s) => (INJECTION.test(skeleton(s)) ? ' [text addressed to the AI removed]' : s))
    .replace(/#{2,}/g, '#').replace(/^\s*(notes|ad text|title|company|location)\s*:/gim, '$1 -');
}
