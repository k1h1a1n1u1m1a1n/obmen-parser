const CITIES = require('./cities');
const WebSource = require('./WebSource');
const TelegramSource = require('./TelegramSource');
const RateBuilder = require('./RateBuilder');
const { sleep } = require('./utils');
const log = require('./log');

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
      webReq ? webReq.catch((err) => { log.error(`web failed [${city.key}]:`, err.message); return null; }) : null,
      tgReady && city.tg
        ? this.telegram.fetchCity(city.tg).catch((err) => { log.error(`tg failed [${city.key}]:`, err.message); return null; })
        : null,
    ]);
    return { web, tg };
  }

  // Concurrent callers share one in-flight pass (avoids duplicate work / Telegram flood).
  parse() {
    if (!this._inflight) {
      this._inflight = this._parse().finally(() => { this._inflight = null; });
    } else {
      log.info('parse already in progress — reusing in-flight pass');
    }
    return this._inflight;
  }

  async _parse() {
    const started = Date.now();
    log.info('parse start');

    let tgReady = true;
    try {
      await this.telegram.connect();
      await this.telegram.refreshMenu();
    } catch (err) {
      tgReady = false;
      log.error('telegram unavailable, degrading to web-only:', err.message);
    }

    const rates = [];
    let failed = 0;
    for (const city of CITIES) {
      const raw = await this._requestCity(city, tgReady);
      const built = this.builder.build(city, raw);
      rates.push(...built);
      if (built.length === 0) failed += 1;
      log.info(`city ${city.key}: web=${raw.web ? 'ok' : '-'} tg=${raw.tg ? 'ok' : '-'} -> ${built.length} rates`);
      await sleep(this.perCityDelayMs);
    }

    log.info(`parse done: ${rates.length} rates, ${CITIES.length - failed}/${CITIES.length} cities ok, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return rates;
  }

  async close() {
    await this.telegram.disconnect();
  }
}

module.exports = Parser;
