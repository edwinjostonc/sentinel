// Example person (fictional): Maria, sustainability / ESG roles in the Netherlands and Sweden; her list is emailed to her and her sheet shared with her.
// After editing: node finder/build-workflows.js --profile=maria, then node tools/host.js --profile=maria --to=her@example.com (imports the workflows).
module.exports = {
  id: 'maria',
  timezone: 'Europe/Amsterdam',
  cvFile: 'examples/maria-cv.txt',   // only used when the Drive files are first created; later the Drive doc is the CV
  currency2: 'SEK',
  prompt: {
    role: 'sustainability, ESG, climate and green-business roles in the Netherlands and Sweden',
    languageRule: '"language": the ad asks for a language that MY RESUME does not show at working level, or the ad itself is not in English.',
    domainHint: '',
    languageNoteExample: '"English only", "Dutch required", "Swedish a plus"',
    coach: 'sustainability, ESG and green-business jobs',
  },
  // facts only Maria's build may contain: red team B09 checks they never show up in anyone else's workflows
  redteamMarkers: ['Portuguese citizen', 'EU citizen, no work permit needed', 'sustainability, ESG, climate'],
  host: {
    ids: { finder: 'SentinelMariaFnd', daily: 'SentinelMariaChk', setup: 'SentinelMariaSet', files: 'SentinelMariaFil', share: 'SentinelMariaShr',
      weekly: 'SentinelMariaWk1', test: 'ZZSentinelMariaT' },
    names: { folder: 'Maria Job Finder', sheet: 'Maria Job List', cvDoc: 'Maria CV (used for job matching)', label: 'Maria', time: '06:30', sender: 'Daily job list',
      where: 'Netherlands · Sweden' },   // shown in the console
    stateFile: 'host-maria.json',
    brokerPort: 5697,           // own n8n task-runner port for host.js (the daily task uses the next one)
    shareSheet: true,           // her tracker: she may edit it (Google sends no email; the link is in every job email)
  },
  search: {
    searchWords: ['sustainability', 'ESG', 'CSRD', 'carbon', 'circular economy', 'climate'],
    titleWordsA: ['sustainab', 'esg', 'csrd', 'carbon', 'climate', 'circular', 'ghg', 'net zero', 'net-zero', 'decarbon', 'environmental', 'energy transition',
      'impact analyst', 'impact associate'],
    // sales roles at green employers: off, only ESG roles
    includeSalesJobs: false, salesSearchWords: [], titleWordsB: [], greenWords: [],
    excludeTitleWords: ['senior', 'sr.', 'sr ', 'lead', 'head of', 'head,', 'director', 'principal', 'vp ', 'vice president', 'chief', 'internship', 'stage ',
      'stagiair', 'praktikum', 'werkstudent', 'working student', 'student', 'phd', 'doctoral', 'professor', 'postdoc', 'lecturer', 'academic', 'research scientist',
      'board of', 'trainee', 'thesis', 'graduation', 'examensarbete', 'afstudeer'],
    aboutMe: 'Portuguese citizen (EU citizen, no work permit needed). Lives in Rotterdam. Wants jobs in the Netherlands or Sweden (English-speaking roles).',

    countries: ['Netherlands', 'Sweden'],
    remote: false,                                  // only jobs located in her two countries
    remoteWhere: '',
    readLocalLanguage: [],                          // English ads only (Dutch/Swedish-language ads are skipped)
    germanUpToB1: false,
    visaChecks: ['nl'],                             // Dutch IND recognised sponsors (shown, not penalised: EU citizen)
    sponsorPenalty: [],
    careerjet: { core: { nl_NL: 'Netherlands', sv_SE: 'Sweden' }, more: {} },
    useLinkedIn: true,
    linkedInLocations: ['Netherlands', 'Sweden'],
    linkedInQueries: ['(sustainability OR ESG OR CSRD OR "carbon accounting" OR "circular economy" OR climate)'],
    linkedInLevels: '2,3',                          // entry, associate
    useArbeitnow: false,
    bundesagentur: null, nhs: null,
    jobtech: { terms: ['sustainability', 'ESG', 'climate', 'carbon', 'circular economy', 'CSRD'] },   // Sweden's public employment service (Arbetsförmedlingen)
    eures: { countries: ['nl', 'se'], terms: ['sustainability', 'ESG', 'climate', 'carbon', 'CSRD'] },  // EU job portal
    companyBoards: [
      ['smartrecruiters', 'EcoVadis'], ['smartrecruiters', 'Vattenfall'],
      ['recruitee', 'sweco'], ['recruitee', 'fastned'], ['recruitee', 'vandebron'], ['recruitee', 'greenchoice'], ['recruitee', 'ecochain'],
      ['teamtailor', 'stegra'], ['teamtailor', 'doconomy'], ['ashby', 'watershed'], ['ashby', 'sylvera'],
    ],
    useAdzuna: false,

    maxAgeDays: 10,                                 // small niche: a longer window (jobs already sent are skipped via the Seen tab)
    companyBoardMaxAgeDays: 30,
    primaryCountries: ['Netherlands', 'Sweden'],
    maxJobsToScore: 60,                             // 6 Flash-Lite calls
    jobsPerAiCall: 10,
    recheck: { minScore: 65, maxJobs: 10, jobsPerCall: 5 },   // at most 2 Flash calls
    tooSeniorTitleWords: ['manager', 'head', 'lead', 'director', 'senior', 'principal', 'chief'],
    minFitScoreToLog: 40,
    emailGreeting: 'Hi Maria, ',
    emailFooter: 'Sent automatically every morning by Sentinel.',
    digestEmail: '__DIGEST_EMAIL__',
  },
};
