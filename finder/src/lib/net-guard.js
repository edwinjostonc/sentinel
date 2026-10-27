// Links in the sheet can be edited by hand (a person the sheet is shared with can edit it), so before the daily check opens one it must be
// a normal public web address: http(s), a real domain name, default port, no login part. IP addresses, localhost and
// internal names are refused, so the check cannot be pointed at this laptop or the home network.
// Written without URL() so it behaves the same inside n8n's Code node sandbox.
const INTERNAL_TLD = /\.(local|localhost|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example|arpa|home\.arpa)$/;
function publicUrl(u) {
  const m = String(u || '').trim().match(/^(https?):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i);
  if (!m) return '';
  const auth = m[2].toLowerCase();
  if (auth.includes('@') || auth.includes('%') || auth.includes('\\')) return '';
  const hp = auth.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!hp) return '';   // IPv6 literals, unicode or odd characters
  const host = hp[1].replace(/\.$/, ''), port = hp[2];
  if (port && !((m[1].toLowerCase() === 'http' && port === '80') || (m[1].toLowerCase() === 'https' && port === '443'))) return '';
  if (!host.includes('.') || /^localhost(\.|$)/.test(host) || INTERNAL_TLD.test(host)) return '';
  // any all-numeric/hex label set is an IP address in one of its spellings (127.0.0.1, 2130706433, 0x7f.1, 0177.0.0.1)
  if (host.split('.').every((p) => /^(0x[0-9a-f]*|\d+)$/.test(p))) return '';
  if (host.split('.').some((p) => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) return '';
  return String(u).trim();
}
// GET a public page; redirects are followed by hand (at most 4), each new address checked again.
async function publicGet(helpers, url, headers) {
  for (let hop = 0; hop < 5; hop++) {
    if (!publicUrl(url)) return { statusCode: 0, body: '', refused: true };
    const r = await helpers.httpRequest({ url, headers, timeout: 25000, returnFullResponse: true, ignoreHttpStatusErrors: true, disableFollowRedirect: true });
    const to = r.statusCode >= 300 && r.statusCode < 400 && r.headers && r.headers.location;
    if (!to) return r;
    url = /^https?:\/\//i.test(to) ? to : String(to).startsWith('/') ? url.match(/^https?:\/\/[^/]+/i)[0] + to : '';
  }
  return { statusCode: 0, body: '', refused: true };
}
