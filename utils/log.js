// utils/log.js

export const logs = [];

export function logResult(label, value) {
  const output = `${label}: ${value || '[LEEG]'}`;
  console.log(`🔍 ${output}`);
  logs.push(`🔹 ${output}`);
  return value;
}

export function printLogs(containerId = '') {
  if (logs.length === 0) return;
  console.log(`\n📦 Logs voor container ${containerId || '[onbekend]'}:\n` + logs.join('\n') + '\n');
  logs.length = 0; // reset na printen
}