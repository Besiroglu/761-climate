// Background check for the 761 climate app (GitHub Actions, every 5 minutes). Same logic as the phone app (src/core.js):
// keeps the sensors that run each room's ceiling in step, drives the great-room ceiling, takes over floors left in
// Messana's auto mode, and when nothing on a floor wants its current mode but a room clearly wants the other one,
// switches the floor (after 45 minutes in the current mode). Floors marked "(hold)" are left alone.
// Usage: MESSANA_KEY=... node supervisor/supervise.js state.json [--dry]
// Logs actions only (the repo is public), never temperatures.
const fs = require('fs');
const Core = require('../src/core.js');
const cfg = require('../src/rooms.json');
const stateFile = process.argv[2] || 'state.json';
const dry = process.argv.includes('--dry');
let key = process.env.MESSANA_KEY;   // GitHub Actions secret; on the Mac, read the saved key file instead
if (!key) { try { key = JSON.parse(fs.readFileSync(require('os').homedir() + '/.house-automation/messana_key.json', 'utf8')).key; } catch (e) {} }
if (!key) { console.error('no Messana key'); process.exit(1); }
const writes = [];
const core = Core.makeCore({ cfg, key, dry, log: m => writes.push(m) });
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
(async () => {
  const now = Date.now();
  const lines = await core.supervise(state, now, 45);
  state.lastRun = new Date(now).toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  for (const l of lines) console.log(l.replace(/; wants .*$/, ''));   // modes and switches only
  console.log(writes.length ? `${writes.length} setting change(s)` : 'no changes');
  for (const w of writes) if (/hc\/mode|hc\/name|fcu\/status/.test(w)) console.log(w);
})().catch(e => { console.error('error:', e.message); process.exit(1); });
