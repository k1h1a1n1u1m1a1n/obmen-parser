const log = require('./log');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const NAV_TIMEOUT_MS = 45000;
const TABLE_WAIT_MS = 25000;
const TABLE_SELECTOR = 'table tbody tr strong';
const ATTEMPTS = 2;

// Resources the rate page does not need. Scripts/xhr/fetch are kept — Cloudflare's
// JS challenge relies on them; blocking only saves bandwidth/memory, not the challenge.
const BLOCKED_RESOURCES = new Set(['image', 'stylesheet', 'font', 'media']);

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-default-apps',
  '--mute-audio',
  '--disable-blink-features=AutomationControlled',
  '--blink-settings=imagesEnabled=false',
];

// Lazy, persistent headless browser for Cloudflare-fronted web sources.
// The browser stays up (cf_clearance cookie lives in its context and is reused),
// but each request gets a fresh page that is closed afterwards — reliable and leak-free.
class Browser {
  constructor() {
    this.browser = null;
    this._launching = null;
  }

  async _get() {
    if (this.browser?.connected) return this.browser;
    if (!this._launching) {
      this._launching = (async () => {
        const puppeteer = require('puppeteer'); // lazy: service runs without it on a whitelisted IP
        this.browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
        log.info('headless browser launched (resources trimmed)');
      })().finally(() => { this._launching = null; });
    }
    await this._launching;
    return this.browser;
  }

  // Loads url in a fresh page, waits for the rate table, returns HTML. Page is always closed.
  async getHtml(url) {
    const browser = await this._get();
    const page = await browser.newPage();
    try {
      await page.setUserAgent(UA);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (BLOCKED_RESOURCES.has(req.resourceType())) req.abort().catch(() => {});
        else req.continue().catch(() => {});
      });

      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        const found = await page.waitForSelector(TABLE_SELECTOR, { timeout: TABLE_WAIT_MS }).then(() => true).catch(() => false);
        if (found) return await page.content();
        log.warn(`browser: no rate table at ${url} (attempt ${attempt}/${ATTEMPTS})`);
      }
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this._launching = null;
    }
  }
}

module.exports = Browser;
