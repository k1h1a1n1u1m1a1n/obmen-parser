const http = require('node:http');
const path = require('node:path');
const Parser = require('./src/Parser');
const log = require('./src/log');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* .env optional — vars may be set in the environment */
}

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = process.env.API_TOKEN || '';

const parser = new Parser({
  tgApiId: Number(process.env.TG_API_ID),
  tgApiHash: process.env.TG_API_HASH,
  tgSession: process.env.TG_SESSION,
  tgChannel: process.env.TG_CHANNEL,
  webBaseUrl: process.env.WEB_BASE_URL,
  partnerBaseUrl: process.env.PARTNER_BASE_URL,
  perCityDelayMs: process.env.PER_CITY_DELAY_MS ? Number(process.env.PER_CITY_DELAY_MS) : undefined,
  emitEur: process.env.EMIT_EUR !== 'false',
  forceBrowser: process.env.WEB_FORCE_BROWSER === 'true',
});

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress;
  log.info(`${req.method} ${url.pathname} from ${ip}`);

  if (url.pathname !== '/rates') {
    log.warn(`404 ${url.pathname} from ${ip}`);
    return send(res, 404, { error: 'not found' });
  }
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    log.warn(`401 unauthorized from ${ip}`);
    return send(res, 401, { error: 'unauthorized' });
  }

  const started = Date.now();
  try {
    const rates = await parser.parse();
    log.info(`200 /rates -> ${rates.length} rates in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return send(res, 200, {
      parsedAt: new Date().toISOString(),
      count: rates.length,
      rates: rates.map((rate) => ({ from: rate.from, to: rate.to, buy: rate.buy.toString() })),
    });
  } catch (err) {
    log.error(`500 /rates after ${((Date.now() - started) / 1000).toFixed(1)}s:`, err.stack || err.message);
    return send(res, 500, { error: err.message });
  }
});

if (!TOKEN) log.warn('API_TOKEN is empty — all requests will be rejected with 401');

// A parse takes ~2 min; don't let the server cut the connection mid-response.
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, () => log.info(`obmen24-rates-api listening on :${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log.info(`${signal} received, shutting down`);
    await parser.close().catch((err) => log.error('shutdown error:', err.message));
    server.close(() => process.exit(0));
  });
}

process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err?.stack || err));
process.on('uncaughtException', (err) => log.error('uncaughtException:', err?.stack || err));
