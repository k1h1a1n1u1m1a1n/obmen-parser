const BigNumber = require('bignumber.js');

// Round to 6 decimals, half-up (mathematical rounding).
const round6 = (value) => value.decimalPlaces(6, BigNumber.ROUND_HALF_UP);

// Builds BoxExchanger { from, to, buy } rates from a city's parsed data.
class RateBuilder {
  constructor({ emitEur = true } = {}) {
    this.emitEur = emitEur;
  }

  // City is encoded into the currency name: <CUR>_<CITY>.
  code(currency, city) {
    return `${currency}_${city.box}`;
  }

  build(city, raw) {
    const out = [];

    const usd = this._minUsd(raw.web?.['USD/UAH'], raw.tg?.usd);
    if (usd) out.push(...this._pair('USD', 'UAH', usd, city));

    if (this.emitEur && raw.web?.['EUR/USD']?.buy && raw.web?.['EUR/USD']?.sell) {
      out.push(...this._pair('EUR', 'USD', raw.web['EUR/USD'], city));
    }

    if (raw.tg?.commissions?.length) out.push(...this._usdtPair(raw.tg.commissions, city));

    return out;
  }

  // USD/UAH from web and tg: take the lower value per side; fall back to whichever exists.
  _minUsd(webUsd, tgUsd) {
    const web = webUsd?.buy && webUsd?.sell ? webUsd : null;
    const tg = tgUsd?.buy && tgUsd?.sell ? tgUsd : null;
    if (web && tg) return { buy: Math.min(web.buy, tg.buy), sell: Math.min(web.sell, tg.sell) };
    return web || tg || null;
  }

  // Spread is encoded by direction: base->quote = buy price, quote->base = 1/sell.
  _pair(base, quote, { buy, sell }, city) {
    return [
      { from: this.code(base, city), to: this.code(quote, city), buy: round6(new BigNumber(buy)) },
      { from: this.code(quote, city), to: this.code(base, city), buy: round6(new BigNumber(1).div(sell)) },
    ];
  }

  // USDT<->USD from bot commissions (standard banknotes). USDT~USD 1:1; office values USDT above cash,
  // so USDT->USD is a markup (1+%) while USD->USDT is a discount (1-%).
  _usdtPair(commissions, city) {
    const find = (give, take) => commissions.find(
      (comm) => comm.officeGives.currency === give && comm.officeGives.quality === 'standard'
        && comm.clientGives.currency === take && comm.clientGives.quality === 'standard',
    );
    const markup = (percent) => round6(new BigNumber(1).plus(new BigNumber(percent).div(100)));
    const discount = (percent) => round6(new BigNumber(1).minus(new BigNumber(percent).div(100)));

    const out = [];
    const toUsd = find('USD', 'USDT'); // client gives USDT, gets USD
    if (toUsd) out.push({ from: this.code('USDT', city), to: this.code('USD', city), buy: markup(toUsd.percent) });
    const toUsdt = find('USDT', 'USD'); // client gives USD, gets USDT
    if (toUsdt) out.push({ from: this.code('USD', city), to: this.code('USDT', city), buy: discount(toUsdt.percent) });
    return out;
  }
}

module.exports = RateBuilder;
