const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { FloodWaitError } = require('telegram/errors');
const { num, sleep } = require('./utils');
const log = require('./log');

const FLOOD_RETRIES = 2;
const MAX_FLOOD_WAIT_S = 30; // longer flood -> skip city (fall back to web) instead of stalling

function parseAsset(part) {
  return {
    currency: /usdt/i.test(part) ? 'USDT' : /\$|usd/i.test(part) ? 'USD' : null,
    quality: /гарн/i.test(part) ? 'good' : 'standard',
  };
}

function parseAnswer(text) {
  const usdMatch = text.match(/USD\s+([\d.,]+)\s*-\s*([\d.,]+)/i);
  const usd = { buy: usdMatch ? num(usdMatch[1]) : null, sell: usdMatch ? num(usdMatch[2]) : null };

  const commissions = [];
  const commissionRe = /(Наш[^\n]+?)\s*\n\s*([\d.,]+)\s*%\s*(з\s+нас|з\s+вас)/gi;
  let match;
  while ((match = commissionRe.exec(text))) {
    const [give, take] = match[1].trim().split(/\s*-\s*/);
    commissions.push({
      officeGives: parseAsset(give),
      clientGives: parseAsset(take),
      percent: num(match[2]),
      feeSide: /нас/.test(match[3]) ? 'ours' : 'yours',
    });
  }
  return { usd, commissions };
}

// Rates from the Telegram channel: clicking a city button returns a callback alert.
class TelegramSource {
  constructor({ apiId, apiHash, session, channel, clickTimeoutMs = 10000 }) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.session = session || '';
    this.channel = channel;
    this.clickTimeoutMs = clickTimeoutMs;
    this.client = null;
    this.menu = null;
  }

  // Connects via saved session (no interactive login).
  async connect() {
    if (this.client && this.client.connected) return;
    if (!this.apiId || !this.apiHash || !this.session) {
      throw new Error('Telegram: TG_API_ID, TG_API_HASH, TG_SESSION required (generate via login.js).');
    }
    this.client = new TelegramClient(new StringSession(this.session), this.apiId, this.apiHash, { connectionRetries: 3, receiveUpdates: false });
    await this.client.connect();
    log.info('telegram connected');
  }

  // Latest "Оберіть місто" menu message.
  async refreshMenu() {
    const msgs = await this.client.getMessages(this.channel, { limit: 15 });
    this.menu = msgs.find((msg) => msg.replyMarkup?.className === 'ReplyInlineMarkup' && /Оберіть місто/i.test(msg.message || ''));
    if (!this.menu) throw new Error('Telegram: "Оберіть місто" menu not found.');
    log.info(`telegram menu #${this.menu.id}, ${this.menu.buttons.flat().length} cities`);
    return this.menu;
  }

  async fetchCity(button) {
    if (!this.menu) await this.refreshMenu();
    let text;
    try {
      text = await this._click(button);
    } catch (err) {
      // Channel reposted the menu mid-pass -> our message id is stale. Refresh and retry once.
      if (/MESSAGE_ID_INVALID/.test(err.errorMessage || err.message || '')) {
        log.warn('tg menu changed — refreshing and retrying click');
        await this.refreshMenu();
        text = await this._click(button);
      } else {
        throw err;
      }
    }
    return text ? parseAnswer(text) : null;
  }

  async _click(button, attempt = 1) {
    try {
      const answer = await Promise.race([
        this.menu.click({ text: button }),
        sleep(this.clickTimeoutMs).then(() => Promise.reject(new Error('tg click timeout'))),
      ]);
      return answer?.message ?? null;
    } catch (err) {
      if (err instanceof FloodWaitError) {
        if (err.seconds <= MAX_FLOOD_WAIT_S && attempt <= FLOOD_RETRIES) {
          log.warn(`tg flood wait ${err.seconds}s on "${button}", retrying`);
          await sleep((err.seconds + 1) * 1000);
          return this._click(button, attempt + 1);
        }
        log.warn(`tg flood wait ${err.seconds}s on "${button}" — skipping`);
      }
      throw err;
    }
  }

  async disconnect() {
    if (!this.client) return;
    this.client.setLogLevel('none'); // silence GramJS ping-loop TIMEOUT logged during teardown
    await this.client.disconnect();
  }
}

module.exports = TelegramSource;
