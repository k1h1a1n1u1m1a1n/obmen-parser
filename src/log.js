const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* logs to console only if the dir can't be created */
}

const stamp = () => new Date().toISOString();
const dayFile = () => path.join(LOG_DIR, `${stamp().slice(0, 10)}.log`); // logs/YYYY-MM-DD.log (UTC)

function write(level, parts) {
  const text = `${stamp()} [${level}] ${parts.join(' ')}`;
  (level === 'INFO' ? console.log : console.error)(text);
  try {
    fs.appendFileSync(dayFile(), `${text}\n`);
  } catch {
    /* non-critical: console already has it */
  }
}

module.exports = {
  info: (...parts) => write('INFO', parts),
  warn: (...parts) => write('WARN', parts),
  error: (...parts) => write('ERROR', parts),
};
