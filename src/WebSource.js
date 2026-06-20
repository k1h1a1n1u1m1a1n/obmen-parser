const cheerio = require('cheerio');
const { num, sleep } = require('./utils');
const log = require('./log');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800;
const FETCH_TIMEOUT_MS = 15000;

function parseTable(html) {
  const $ = cheerio.load(html);
  const rates = {};
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('th,td').map((__, cell) => $(cell).text().trim()).get();
    if (cells.length >= 3 && /^[A-Z]{3}\/[A-Z]{3}$/.test(cells[0])) {
      rates[cells[0]] = { buy: num(cells[1]), sell: num(cells[2]) };
    }
  });
  return rates;
}

// Rates from obmen24-style sites (server-rendered HTML, same rate table, plain fetch).
// urlFor(slug) -> full page URL.
class WebSource {
  constructor({ urlFor }) {
    this.urlFor = urlFor;
    this.cookies = new Map();
  }

  async fetchCity(slug) {
    const html = await this._get(this.urlFor(slug));
    return parseTable(html);
  }

  _headers() {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="138", "Google Chrome";v="138", "Not=A?Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': cookie ? 'same-origin' : 'none',
      ...(cookie ? { Cookie: cookie } : {}),
    };
  }

  _storeCookies(res) {
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async _get(url, attempt = 1) {
    let res;
    try {
      res = await fetch(url, { headers: this._headers(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      // network error or timeout — retriable
      if (attempt <= MAX_RETRIES) {
        log.warn(`web ${err.name === 'TimeoutError' ? 'timeout' : err.message} ${url} — retry ${attempt}/${MAX_RETRIES}`);
        await sleep(RETRY_BASE_MS * attempt);
        return this._get(url, attempt + 1);
      }
      throw err;
    }
    this._storeCookies(res);
    if (res.ok) return res.text();
    const retriable = res.status === 429 || res.status === 403 || res.status >= 500;
    if (retriable && attempt <= MAX_RETRIES) {
      log.warn(`web HTTP ${res.status} ${url} — retry ${attempt}/${MAX_RETRIES}`);
      await sleep(RETRY_BASE_MS * attempt);
      return this._get(url, attempt + 1);
    }
    throw new Error(`web HTTP ${res.status}`);
  }
}

module.exports = WebSource;
