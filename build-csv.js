/* Writes the full tracker to CSV from data.js so the file and the site never drift apart. */
const fs = require('fs');
const path = require('path');
require('./data.js');
const out = path.resolve(__dirname, '..', 'gta6_glitch_tracker.csv');
fs.writeFileSync(out, '\ufeff' + globalThis.TRACKER.toCsv(globalThis.TRACKER.entries));
console.log('Wrote', out, 'rows:', globalThis.TRACKER.entries.length);
