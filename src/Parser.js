const CITIES = require('./cities');
const WebSource = require('./WebSource');
const TelegramSource = require('./TelegramSource');
const RateBuilder = require('./RateBuilder');
const { sleep } = require('./utils');

// Scrapes every city (web + Telegram) and builds BoxExchanger { from, to, buy } pairs.
class Parser {
  constructor(opts = {}) {
    this.perCityDelayMs = opts.perCityDelayMs ?? 1500;

    const webBase = opts.webBaseUrl || 'https://obmen24.com.ua/uk';
    const partnerBase = opts.partnerBaseUrl || 'https://x-change-x.com';
    this.web = new WebSource({ urlFor: (slug) => `${webBase}/${slug}` });
    this.partner = new WebSource({ urlFor: (slug) => `${partnerBase}/${slug}/currency-exchange/` });
    this.telegram = new TelegramSource({
      apiId: opts.tgApiId,
      apiHash: opts.tgApiHash,
      session: opts.tgSession,
      channel: opts.tgChannel || 'tradingbearbullbest',
    });
    this.builder = new RateBuilder({ emitEur: opts.emitEur !== false });
    this._inflight = null;
  }

  // obmen24 if the city is on the main site, else the partner site.
  _fetchWeb(city) {
    if (city.web) return this.web.fetchCity(city.web);
    if (city.partner) return this.partner.fetchCity(city.partner);
    return null;
  }

  // Fetch both sources for one city (in parallel). tgReady=false -> web only.
  async _requestCity(city, tgReady) {
    const webReq = this._fetchWeb(city);
    const [web, tg] = await Promise.all([
      webReq ? webReq.catch(() => null) : null,
      tgReady && city.tg ? this.telegram.fetchCity(city.tg).catch(() => null) : null,
    ]);
    return { web, tg };
  }

  // Concurrent callers share one in-flight pass (avoids duplicate work / Telegram flood).
  parse() {
    if (!this._inflight) {
      this._inflight = this._parse().finally(() => { this._inflight = null; });
    }
    return this._inflight;
  }

  async _parse() {
    let tgReady = true;
    try {
      await this.telegram.connect();
      await this.telegram.refreshMenu();
    } catch {
      tgReady = false; // degrade to web-only
    }

    const rates = [];
    for (const city of CITIES) {
      const raw = await this._requestCity(city, tgReady);
      rates.push(...this.builder.build(city, raw));
      await sleep(this.perCityDelayMs);
    }
    return rates;
  }

  async close() {
    await this.telegram.disconnect();
  }
}

module.exports = Parser;
