// Column order: moves whole Jobs columns (header + every row) into JOBS_HEADERS order, so rows never lose their data.
// A column the sheet does not have yet is inserted empty (its header is written next); columns we do not know stay at the end.
const H = JOBS_HEADERS;
const now = (($input.first().json.values || [])[0] || []).map((v) => String(v).trim());
const tabs = $('Read Sheet').first().json.sheets || [];
const jobsTab = tabs.find((s) => s.properties.title === 'Jobs');
const requests = [];
if (now.length && jobsTab) {
  // safety: only reorder a sheet that really is a job list from this engine
  if (!['Role', 'Company', 'Job Link', 'Status'].every((h) => now.includes(h))) throw new Error('Jobs tab headers not recognised: ' + now.join(', ').slice(0, 300));
  const sheetId = jobsTab.properties.sheetId;
  const cols = now.slice();
  H.forEach((name, i) => {
    const at = cols.indexOf(name, i);
    if (at === i) return;
    if (at > i) {
      requests.push({ moveDimension: { source: { sheetId, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, destinationIndex: i } });
      cols.splice(at, 1);
    } else {
      requests.push({ insertDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, inheritFromBefore: false } });
    }
    cols.splice(i, 0, name);
  });
}
// batchUpdate needs at least one request: rename the first tab to itself when nothing has to move
const first = tabs[0].properties;
return [{ json: { moves: requests.length, body: { requests: requests.length ? requests
  : [{ updateSheetProperties: { properties: { sheetId: first.sheetId, title: first.title }, fields: 'title' } }] } } }];
