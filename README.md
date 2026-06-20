# obmen24-rates-api

Rate parsing service. Scrapes all cities from:

- **Web (main)** — `obmen24.com.ua`: USD/UAH, EUR/USD.
- **Web (partner)** — `x-change-x.com`: same table, used for cities not on the main site.
- **Telegram** — `@tradingbearbullbest` channel (callback buttons): USD/UAH + USDT commissions.

Builds BoxExchanger `{ from, to, buy }` pairs (city encoded into the currency name, e.g. `USD_KYIV`)
and exposes them over HTTP. The BoxExchanger plugin (`parser-obmen24`) consumes this endpoint.

## API

```
GET /rates
Authorization: Bearer <API_TOKEN>
```

Response:

```json
{
  "parsedAt": "2026-06-11T09:00:00.000Z",
  "count": 128,
  "rates": [
    { "from": "USD_KYIV", "to": "UAH_KYIV", "buy": "44.15" },
    { "from": "UAH_KYIV", "to": "USD_KYIV", "buy": "0.022548" }
  ]
}
```

`buy` is a string (exact decimal). Each request triggers a fresh parse (~60–80s with Telegram);
concurrent requests share one in-flight parse. A missing source degrades gracefully (web-only / TG fallback).

## Setup

1. `npm install`
2. Telegram API creds at https://my.telegram.org. The account must be subscribed to the channel.
3. Create `.env`:
   ```
   PORT=8080
   API_TOKEN=<long random token>
   TG_API_ID=...
   TG_API_HASH=...
   TG_SESSION=
   ```
4. Generate the session (interactive): `node login.js` → paste the printed value into `TG_SESSION`.
5. `npm start`

## Env

| Var | Default | Note |
|-----|---------|------|
| `PORT` | 8080 | |
| `API_TOKEN` | — | required; requests without `Bearer` token get 401 |
| `TG_API_ID` / `TG_API_HASH` / `TG_SESSION` | — | Telegram userbot creds |
| `TG_CHANNEL` | tradingbearbullbest | |
| `WEB_BASE_URL` | https://obmen24.com.ua/uk | |
| `PARTNER_BASE_URL` | https://x-change-x.com | |
| `PER_CITY_DELAY_MS` | 1500 | anti-flood gap between cities |
| `EMIT_EUR` | true | set `false` to skip EUR/USD |

Run on a host with a clean (non-datacenter/VPN) IP — Cloudflare challenges datacenter IPs.
