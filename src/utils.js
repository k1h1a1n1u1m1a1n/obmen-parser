const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse a localized number ("44,10") to float, or null.
function num(value) {
  const parsed = parseFloat(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = { sleep, num };
