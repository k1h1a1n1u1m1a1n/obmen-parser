const log = require('./log');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const NAV_TIMEOUT_MS = 60000;
const TABLE_WAIT_MS = 30000;

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

// Lazy, persistent headless browser used for Cloudflare-fronted web sources.
// One browser/page reused across cities so the cf_clearance cookie carries over.
class Browser {
  constructor() {
    this.browser = null;
    this.page = null;
    this._launching = null;
    this._busy = null;
  }

  async _page() {
    if (this.page) return this.page;
    if (!this._launching) this._launching = this._launch();
    await this._launching;
    return this.page;
  }

  async _launch() {
    const puppeteer = require('puppeteer'); // lazy: service runs without it on a whitelisted IP
    this.browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(UA);
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      if (BLOCKED_RESOURCES.has(req.resourceType())) req.abort();
      else req.continue();
    });
    log.info('headless browser launched (resources trimmed)');
  }

  // Loads url through the browser, waits for the rate table, returns the rendered HTML.
  // Serialized: the shared page handles one navigation at a time.
  async getHtml(url) {
    while (this._busy) await this._busy;
    let release;
    this._busy = new Promise((r) => { release = r; });
    try {
      const page = await this._page();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForSelector('table tbody tr strong', { timeout: TABLE_WAIT_MS }).catch(() => {});
      return await page.content();
    } finally {
      release();
      this._busy = null;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
      this._launching = null;
    }
  }
}

module.exports = Browser;
