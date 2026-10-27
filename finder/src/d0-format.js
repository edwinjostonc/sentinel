// Sheet formatting: header with help notes, frozen Status..Role, one-line rows, stripes, dropdowns, status/verdict colours.
// Safe to run again: old colour rules and stripes are removed first, cell values are never touched.
const sheets = $input.first().json.sheets || [];
const tab = (t) => sheets.find((s) => s.properties.title === t);
const jobsTab = tab('Jobs');
const jobs = jobsTab.properties.sheetId;
const H = JOBS_HEADERS;
const col = (name) => H.indexOf(name);
const CORE = col('Notes') + 1;   // Status .. Notes: what people use every day; the rest are details
const W = { 'Status': 105, 'Fit Score': 70, 'Verdict': 75, 'Role': 270, 'Company': 170, 'Country': 90, 'Location': 140, 'Work Mode': 90, 'Job Link': 190,
  'Applied On': 90, 'Follow-up': 165, 'Notes': 220, 'Date Found': 90, 'Posted': 90, 'Why It Fits': 320, 'Gaps': 240, 'Visa / Sponsor': 200, 'Language': 150,
  'Salary': 150, 'Salary (EUR/yr)': 105, [SALARY2_HEADER]: 105, 'Resume Changes': 320, 'More Links': 160, 'Source': 110 };
const NOTE = {
  'Status': 'Change this when you act: Applied, Interview, Offer, Rejected or Not for me.\nExpired is set automatically when the job ad is gone.',
  'Fit Score': 'How well the job matches the CV, 0-100 (AI). 75+ is strong.',
  'Verdict': 'Strong = 75+, Good = 55+, Possible = 40+, Weak = below 40.',
  'Job Link': 'Click to open the job ad.',
  'Applied On': 'Filled in automatically the morning after Status is set to Applied (you can type a date yourself).',
  'Follow-up': '"Due" 7 days after applying: send a short follow-up email, then pick Done.',
  'Notes': 'Warnings from the job finder (visa, language, ...). Add your own notes here too.',
  'Date Found': 'The day the job finder added this job.',
  'Posted': 'When the employer posted the job, if the site says.',
  'Why It Fits': 'AI: why this job matches. Click the cell to read all of it.',
  'Gaps': 'AI: what the job asks for that the CV does not show.',
  'Resume Changes': 'AI: what to change in the CV for this job (never invents facts).',
  'Visa / Sponsor': 'Visa or sponsorship notes for this country.',
  'Language': 'Languages the ad asks for.',
  'Salary': 'Salary as written in the ad.',
  'More Links': 'The same job on other sites.',
  'Source': 'The job site it was found on.',
};
const rgb = (h) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 });
const fmtRange = (sheetId, c0, c1, rows = [0, 1]) => ({ sheetId, startRowIndex: rows[0], endRowIndex: rows[1], startColumnIndex: c0, endColumnIndex: c1 });
const header = (sheetId, n, color) => [
  { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
  { repeatCell: { range: fmtRange(sheetId, 0, n), cell: { userEnteredFormat: {
    backgroundColor: rgb(color), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { bold: true, foregroundColor: rgb('ffffff') } } },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)' } },
];
const body = (c0, c1) => ({ sheetId: jobs, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: c0, endColumnIndex: c1 });
const list = (c, values) => ({ setDataValidation: { range: body(c, c + 1),
  rule: { condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
const L = (i) => String.fromCharCode(65 + i);   // fine while we have < 26 columns
const S = `$${L(col('Status'))}2`;
const rule = (c0, c1, condition, format) => ({ ranges: [body(c0, c1)], booleanRule: { condition, format } });
const cellIs = (c, text, bg, fg, bold = true) => rule(c, c + 1, { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] },
  { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg), bold } });
const rules = [
  rule(0, H.length, { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=OR(${S}="Expired",${S}="Not for me",${S}="Rejected")` }] },
    { textFormat: { foregroundColor: rgb('9aa0a6') }, backgroundColor: rgb('eeeeee') }),
  cellIs(col('Status'), 'Applied', 'd2e3fc', '174ea6'),
  cellIs(col('Status'), 'Interview', 'e9d2fd', '681da8'),
  cellIs(col('Status'), 'Offer', 'b7e1cd', '0d652d'),
  rule(col('Follow-up'), col('Follow-up') + 1, { type: 'TEXT_STARTS_WITH', values: [{ userEnteredValue: 'Due' }] }, { backgroundColor: rgb('fce8b2'), textFormat: { bold: true } }),
  cellIs(col('Verdict'), 'Strong', 'ceead6', '0d652d'),
  cellIs(col('Verdict'), 'Good', 'e6f4ea', '137333', false),
  cellIs(col('Verdict'), 'Possible', 'fef7e0', 'b06000', false),
  cellIs(col('Verdict'), 'Weak', 'ffffff', '80868b', false),
  { ranges: [body(col('Fit Score'), col('Fit Score') + 1)], gradientRule: { minpoint: { color: rgb('f4c7c3'), type: 'NUMBER', value: '40' },
    midpoint: { color: rgb('fce8b2'), type: 'NUMBER', value: '60' }, maxpoint: { color: rgb('b7e1cd'), type: 'NUMBER', value: '85' } } },
];
const oldRules = (jobsTab.conditionalFormats || []).length;
const oldBands = (jobsTab.bandedRanges || []).map((b) => b.bandedRangeId);
const center = ['Fit Score', 'Verdict', 'Country', 'Work Mode', 'Applied On', 'Date Found', 'Posted', 'Salary (EUR/yr)', SALARY2_HEADER].map(col).filter((c) => c >= 0);
const requests = [
  // header: daily columns dark green, detail columns lighter; a short help note on each name
  ...header(jobs, CORE, '1b4332'),
  ...header(jobs, H.length, '1b4332').slice(1).map((r) => { r.repeatCell.range.startColumnIndex = CORE; r.repeatCell.cell.userEnteredFormat.backgroundColor = rgb('52796f'); return r; }),
  { updateSheetProperties: { properties: { sheetId: jobs, gridProperties: { frozenRowCount: 1, frozenColumnCount: col('Role') + 1 } },
    fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  { updateCells: { range: fmtRange(jobs, 0, H.length), rows: [{ values: H.map((h) => ({ note: NOTE[h] || '' })) }], fields: 'note' } },
  { updateDimensionProperties: { range: { sheetId: jobs, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
  // rows: one line each, long text cut off (click a cell to read it all)
  { repeatCell: { range: body(0, H.length), cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP', horizontalAlignment: 'LEFT', textFormat: { bold: false } } },
    fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,horizontalAlignment,textFormat.bold)' } },
  ...center.map((c) => ({ repeatCell: { range: body(c, c + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } })),
  { repeatCell: { range: body(col('Fit Score'), col('Fit Score') + 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  { repeatCell: { range: body(col('Role'), col('Role') + 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  // fixed standard height (= what rows added later get): text with line breaks would otherwise make some rows tall
  { updateDimensionProperties: { range: { sheetId: jobs, dimension: 'ROWS', startIndex: 1, endIndex: jobsTab.properties.gridProperties.rowCount }, properties: { pixelSize: 21 }, fields: 'pixelSize' } },
  ...H.map((h, i) => ({ updateDimensionProperties: { range: { sheetId: jobs, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: W[h] || 120 }, fields: 'pixelSize' } })),
  { setBasicFilter: { filter: { range: { sheetId: jobs, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: H.length } } } },
  // dropdowns: cleared first so none is left behind on a column that moved
  { setDataValidation: { range: body(0, H.length) } },
  list(col('Status'), ['To apply', 'Applied', 'Interview', 'Offer', 'Rejected', 'Not for me', 'Expired']),
  list(col('Follow-up'), ['Due – send a short follow-up', 'Done']),
  // colours: old rules and stripes out, new ones in (the first matching rule wins, so greyed-out rows come first)
  ...Array.from({ length: oldRules }, (_, k) => ({ deleteConditionalFormatRule: { sheetId: jobs, index: oldRules - 1 - k } })),
  ...rules.map((r, index) => ({ addConditionalFormatRule: { index, rule: r } })),
  ...oldBands.map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } })),
  { addBanding: { bandedRange: { range: body(0, H.length), rowProperties: { firstBandColor: rgb('ffffff'), secondBandColor: rgb('f3f6f4') } } } },
  // tabs: Seen is the job finder's memory of jobs already sent, hidden so people only see what they need
  { updateSheetProperties: { properties: { sheetId: jobs, tabColor: rgb('1b4332') }, fields: 'tabColor' } },
  ...(tab('Weekly') ? [{ updateSheetProperties: { properties: { sheetId: tab('Weekly').properties.sheetId, tabColor: rgb('1a73e8') }, fields: 'tabColor' } }] : []),
  ...(tab('Errors') ? [{ updateSheetProperties: { properties: { sheetId: tab('Errors').properties.sheetId, tabColor: rgb('a50e0e') }, fields: 'tabColor' } }] : []),
  ...(tab('Seen') ? [{ updateSheetProperties: { properties: { sheetId: tab('Seen').properties.sheetId, hidden: true }, fields: 'hidden' } }] : []),
  ...header(tab('Seen').properties.sheetId, 5, '5f6368'),
  ...header(tab('Errors').properties.sheetId, 4, 'a50e0e'),
  ...header(tab('Weekly').properties.sheetId, WEEKLY_HEADERS.length, '1b4332'),
  { repeatCell: { range: { sheetId: tab('Weekly').properties.sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: WEEKLY_HEADERS.length },
    cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } },
  ...WEEKLY_HEADERS.map((h, i) => ({ updateDimensionProperties: { range: { sheetId: tab('Weekly').properties.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: ['Top Skills Asked', 'Your Top Gaps', 'Learn Next', 'Best Companies', 'By Country'].includes(h) ? 260 : 110 }, fields: 'pixelSize' } })),
];
return [{ json: { body: { requests } } }];
