// One-time login: prints TG_SESSION to paste into .env.
const path = require('node:path');
const readline = require('node:readline/promises');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* .env optional */
}

(async () => {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) throw new Error('Set TG_API_ID and TG_API_HASH (.env or env).');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
  await client.start({
    phoneNumber: () => rl.question('Phone (with country code): '),
    password: () => rl.question('2FA password (if set): '),
    phoneCode: () => rl.question('Code from Telegram: '),
    onError: (err) => console.error(err),
  });
  rl.close();

  console.log('\nTG_SESSION (paste into .env):\n');
  console.log(client.session.save());
  await client.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
