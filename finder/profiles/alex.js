// Example person (fictional): Alex, junior data analyst / BI / IT support, Germany + UK first, then English-speaking EU; health tech and startups.
// Copy this file to finder/profiles/<you>.js and change everything to your own search.
// After editing: node finder/build-workflows.js --profile=alex, then node tools/host.js --profile=alex --to=you@example.com (imports the workflows).
const EU = ['Netherlands', 'Ireland', 'Malta', 'Belgium', 'Luxembourg', 'Austria', 'France', 'Spain', 'Portugal', 'Italy', 'Denmark', 'Sweden', 'Finland', 'Poland',
  'Czechia', 'Greece', 'Hungary', 'Romania', 'Cyprus', 'Estonia', 'Latvia', 'Lithuania', 'Slovakia', 'Slovenia', 'Croatia', 'Bulgaria'];

module.exports = {
  id: 'alex',
  timezone: 'Europe/Berlin',
  cvFile: 'examples/alex-cv.txt',   // only used when the Drive files are first created; later the Drive doc is the CV
  currency2: 'GBP',                 // second salary column next to EUR
  prompt: {
    role: 'junior data analyst, business intelligence and IT support roles in Germany, the UK and the EU, including health tech and startups',
    languageRule: '"language": the ad asks for German above B1 (B2, C1, fluent, native, "sehr gute Deutschkenntnisse") or another language that MY RESUME does not show at working level. German up to B1, or an ad written in German without a stated level, is NOT a blocker (ABOUT ME: German A2, learning).',
    domainHint: ' Health tech data is close to my MSc project on patient wait times.',
    languageNoteExample: '"English only", "German B1", "German a plus"',
    coach: 'data analyst, business intelligence and IT support jobs',
  },
  // facts only Alex's build may contain: red team B09 checks they never show up in anyone else's workflows
  redteamMarkers: ['patient wait times', 'German A2', 'health tech and startups'],
  host: {
    ids: { finder: 'SentinelAlexFind', daily: 'SentinelAlexChck', setup: 'SentinelAlexSetp', files: 'SentinelAlexFile', weekly: 'SentinelAlexWeek', test: 'ZZSentinelAlexTs' },
    names: { folder: 'Alex Job Finder', sheet: 'Alex Job List', cvDoc: 'Alex CV (used for job matching)', label: 'Alex', time: '07:15', sender: 'Alex job finder',
      where: 'Germany · UK · EU · remote' },   // shown in the console
    stateFile: 'host-alex.json',
    brokerPort: 5695,           // own n8n task-runner port for host.js (the daily task uses the next one)
    shareSheet: false,          // the owner's own sheet
  },
  // everything below becomes the workflow's Config node
  search: {
    // one search per word per country (the first 3 also in the "more" Careerjet countries)
    searchWords: ['data analyst', 'business intelligence', 'IT support', 'reporting analyst', 'power bi', 'service desk'],
    // title must contain one of these
    titleWordsA: ['data analyst', 'data analytics', 'datenanalyst', 'business intelligence', ' bi ', 'bi-', 'bi analyst', 'bi developer', 'power bi', 'tableau',
      'reporting analyst', 'reporting specialist', 'reporting developer', 'data & reporting', 'data and reporting', 'reporting & analytics',
      'mi analyst', 'analytics analyst', 'insights analyst', 'business analyst', 'product analyst', 'marketing analyst', 'sales analyst', 'operations analyst',
      'junior analyst', 'sql analyst', 'it support', 'it-support', 'service desk', 'servicedesk', 'help desk', 'helpdesk', 'desktop support',
      'technical support', 'it technician', 'it specialist', 'application support', 'support engineer', '1st level', '2nd level',
      'information analyst', 'performance analyst', 'insight analyst', 'systems analyst', 'it analyst'],
    // sales roles at green employers (group B, see maria.js): off here
    includeSalesJobs: false, salesSearchWords: [], titleWordsB: [], greenWords: [],
    // whole words, so "International ..." is not dropped by "intern"
    excludeTitleWords: ['senior', 'sr.', 'sr ', 'lead', 'head of', 'head,', 'director', 'principal', 'vp ', 'vice president', 'chief', 'werkstudent', 'working student',
      'student', 'phd', 'doctoral', 'professor', 'postdoc', 'lecturer', 'academic', 'research scientist', 'board of', 'ausbildung', 'apprentice'],
    // context for the AI that is not in the CV
    aboutMe: 'Lives in Berlin, Germany. Wants jobs in Germany and the UK first, then English-speaking roles elsewhere in the EU; open to remote. Needs visa sponsorship for UK jobs. Interested in data and IT roles in health tech and well-funded startups. German: A2 and learning, so jobs asking for German up to B1 are fine; B2, C1, fluent or native German is a blocker. Graduated, so internships that need a university enrolment are not possible.',

    countries: ['Germany', 'UK', ...EU],
    remote: true,                                   // remote jobs open to Europe / worldwide
    remoteWhere: 'europe|emea|germany|united kingdom|\\buk\\b|worldwide|anywhere',
    readLocalLanguage: ['Germany', 'Austria'],      // German-language ads are read here (German up to B1 is OK)
    germanUpToB1: true,
    visaChecks: ['uk'],                             // UK Home Office sponsor register
    sponsorPenalty: ['UK'],                         // tell the AI when an employer there cannot sponsor
    careerjet: { core: { de_DE: 'Germany', en_GB: 'UK' },
      more: { nl_NL: 'Netherlands', en_IE: 'Ireland', de_AT: 'Austria', en_BE: 'Belgium', fr_FR: 'France', es_ES: 'Spain', pt_PT: 'Portugal', sv_SE: 'Sweden', pl_PL: 'Poland' } },
    useLinkedIn: true,
    linkedInLocations: ['Germany', 'United Kingdom', 'European Union'],
    linkedInQueries: ['("data analyst" OR "business intelligence" OR "BI analyst" OR "reporting analyst" OR "power bi")',
      '("IT support" OR "service desk" OR "help desk" OR "IT specialist" OR "desktop support")'],
    linkedInLevels: '1,2,3',                        // internship, entry, associate
    useArbeitnow: true,
    bundesagentur: { terms: ['Data Analyst', 'Datenanalyst', 'Business Intelligence', 'BI Analyst', 'Power BI', 'IT Support', 'Service Desk', 'Helpdesk'] },
    nhs: { terms: ['data analyst', 'information analyst', 'business intelligence', 'IT support'], maxAgeDays: 14 },   // NHS search is not by date
    jobtech: null, eures: null,
    // company career pages (Greenhouse / Ashby / SmartRecruiters / Recruitee / Teamtailor board names)
    companyBoards: [
      ['greenhouse', 'n26'], ['greenhouse', 'getyourguide'], ['greenhouse', 'hellofresh'], ['greenhouse', 'sumup'], ['greenhouse', 'contentful'],
      ['greenhouse', 'monzo'], ['greenhouse', 'deliveroo'], ['greenhouse', 'gocardless'], ['smartrecruiters', 'DeliveryHero'],
      ['ashby', 'n8n'], ['ashby', 'synthesia'], ['ashby', 'elevenlabs'], ['greenhouse', 'doctolib'], ['ashby', 'accurx'],
    ],
    useAdzuna: false,                               // needs an "Adzuna" credential in n8n

    maxAgeDays: 4,
    companyBoardMaxAgeDays: 30,
    primaryCountries: ['UK', 'Germany'],            // filled first, in turns per source, when there are more new jobs than maxJobsToScore
    maxJobsToScore: 100,                            // 10 Flash-Lite calls
    jobsPerAiCall: 10,                              // the CV goes with every call, so fewer, bigger calls use less
    recheck: { minScore: 65, maxJobs: 15, jobsPerCall: 5 },   // second check by a stronger model: at most 3 Flash calls
    tooSeniorTitleWords: ['manager', 'head', 'lead', 'director', 'senior', 'principal', 'chief'],
    minFitScoreToLog: 40,                           // lower scores go to the Seen tab
    emailGreeting: '',                              // own email: no "Hi ..."
    emailFooter: 'Sent every morning by your job finder (Germany, UK, EU).',
    digestEmail: '__DIGEST_EMAIL__',
  },
};
