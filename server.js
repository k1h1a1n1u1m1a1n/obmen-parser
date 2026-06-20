const http = require('node:http');
const path = require('node:path');
const Parser = require('./src/Parser');

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
});

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/rates') return send(res, 404, { error: 'not found' });
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });

  try {
    const rates = await parser.parse();
    return send(res, 200, {
      parsedAt: new Date().toISOString(),
      count: rates.length,
      rates: rates.map((rate) => ({ from: rate.from, to: rate.to, buy: rate.buy.toString() })),
    });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

// A parse takes ~2 min; don't let the server cut the connection mid-response.
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, () => console.log(`obmen24-rates-api listening on :${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await parser.close().catch(() => {});
    server.close(() => process.exit(0));
  });
}
