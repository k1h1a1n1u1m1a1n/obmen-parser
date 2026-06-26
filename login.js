// One-time login: prints TG_SESSION to paste into .env.
// Pins the home DC (Ukrainian numbers -> DC2) so the auth flow does not migrate
// mid-login — that migration makes GramJS drop the connection (AUTH_KEY_UNREGISTERED).
const path = require('node:path');
const readline = require('node:readline/promises');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* .env optional */
}

const HOME_DC = Number(process.env.TG_HOME_DC) || 2; // +380 numbers live on DC2

(async () => {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) throw new Error('Set TG_API_ID and TG_API_HASH (.env or env).');

  // Discover the home DC address (on Node GramJS needs an API call to resolve it).
  const probe = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await probe.connect();
  const dc = await probe.getDC(HOME_DC);
  probe.setLogLevel('none');
  await probe.disconnect();

  // Start the login already on the home DC — no migration, no dropped auth.
  const session = new StringSession('');
  session.setDC(HOME_DC, dc.ipAddress, dc.port);
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5, receiveUpdates: false });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await client.start({
    phoneNumber: () => rl.question('Phone (with country code): '),
    password: () => rl.question('2FA password (if set): '),
    phoneCode: () => rl.question('Code from Telegram: '),
    forceSMS: process.env.TG_FORCE_SMS === 'true', // best-effort SMS; Telegram may ignore it for API logins
    onError: (err) => console.error(err),
  });
  rl.close();

  console.log('\nTG_SESSION (paste into .env):\n');
  console.log(client.session.save());
  client.setLogLevel('none');
  await client.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
