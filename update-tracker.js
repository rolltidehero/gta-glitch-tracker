#!/usr/bin/env node
/* =============================================================================
   GTA VI Glitch and Money Exploit Tracker: single update script
   =============================================================================

   WHAT THIS DOES
   --------------
   One command rebuilds everything from one source file:

       tracker-data.json   (the only file you edit)
              |
              v
       data.js             (generated: what the website loads)
       ../gta6_glitch_tracker.csv          (generated: the spreadsheet export)
       ../gta6_tracker_last_update.json    (generated: what changed in this run)

   HOW TO RUN
   ----------
       node update-tracker.js                 Full run: validate, rebuild, test, commit
       node update-tracker.js --dry-run       Validate and test only. Writes nothing.
       node update-tracker.js --check-links   Also test every source URL (slower)
       node update-tracker.js --build 1.003.000   Record a new game build number
       node update-tracker.js --as-of "November 25, 2026"   Set the "Checked" date by hand
       node update-tracker.js --no-stamp      Keep the "Checked" date as it is
       node update-tracker.js --no-commit     Rebuild but do not make a git commit
       node update-tracker.js --message "Mark M-05 as verified"   Custom commit subject
       node update-tracker.js --compact       Shorter progress output
       node update-tracker.js --help          Show this help

   Requirements: Node.js 18 or newer. No npm packages. Git is optional.

   STEPS (shown live while the script runs)
   ----------------------------------------
    1. Preflight checks            Node version, required files
    2. Load tracker data           Read and parse tracker-data.json
    3. Validate tracker data       IDs, allowed values, source links, cross references
    4. Stamp date and build        Update "Checked" date and build number
    5. Generate data.js            Fill defaults and write the website data file
    6. Generate CSV                Write the spreadsheet export
    7. Self-test generated files   Load data.js like a browser would, re-read the CSV
    8. Build change report         Compare against the last committed version
    9. Check source links          Only with --check-links
   10. Commit to git               Skipped with --no-commit or --dry-run

   SAFETY
   ------
   - Every problem found in step 3 is listed at once, with the entry it belongs to.
   - If anything fails after files were written, the previous data.js, CSV and
     tracker-data.json are restored, so the website never ends up half updated.
   - Publishing the website is a separate step. This script prints a reminder.

   EXIT CODES
   ----------
       0  success
       1  the data has problems (fix tracker-data.json and run again)
       2  unexpected error (see the message and hint printed above the summary)
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

/* ---------------------------------------------------------------------------
   Configuration
   --------------------------------------------------------------------------- */
const SITE_DIR = __dirname;
const PATHS = {
  json: path.join(SITE_DIR, 'tracker-data.json'),
  dataJs: path.join(SITE_DIR, 'data.js'),
  appJs: path.join(SITE_DIR, 'app.js'),
  indexHtml: path.join(SITE_DIR, 'index.html'),
  csv: path.resolve(SITE_DIR, '..', 'gta6_glitch_tracker.csv'),
  report: path.resolve(SITE_DIR, '..', 'gta6_tracker_last_update.json'),
};

/* The "Checked" date is written in this timezone. */
const TIMEZONE = 'America/Chicago';

/* Allowed values. Adding a new value here is all the script needs; the website
   shows unknown values with a neutral badge. */
const ALLOWED = {
  category: ['Money exploit', 'Built-in cheat', 'Duplication claim', 'Hoax or scam', 'Vehicle launch', 'Flying anomaly', 'Map clipping', 'Other physics'],
  repro: ['Repeatable', 'Recurring', 'Isolated', 'Unverified claim'],
  status: ['Unpatched', 'Partially patched', 'Patched', 'Disputed', 'Not a bug', 'Unverified', 'Not real'],
  platform: ['Reported', 'Unspecified', 'Not affected', 'Not released'],
  sp: ['Yes', 'No'],
  online: ['Yes', 'No', 'No online mode'],
};

/* Which ID prefix belongs to which categories (a mismatch is only a warning). */
const ID_PREFIX = {
  M: ['Money exploit', 'Built-in cheat', 'Duplication claim', 'Hoax or scam'],
  V: ['Vehicle launch'],
  F: ['Flying anomaly'],
  C: ['Map clipping'],
  P: ['Other physics'],
};

/* Field order of every entry in the generated data.js. */
const ENTRY_FIELDS = ['id', 'name', 'category', 'moneyRank', 'money', 'ps5', 'xbox', 'pc', 'repro', 'status', 'sp', 'online', 'summary', 'steps', 'payout', 'tips', 'caveats', 'reportedBy', 'sources', 'carDupe'];

/* Fields compared in the change report, with the label printed for each. */
const TRACKED_FIELDS = {
  name: 'Name', category: 'Category', money: 'Money potential', ps5: 'PS5', xbox: 'Xbox', pc: 'PC',
  repro: 'Reproducibility', status: 'Patch status', sp: 'Single-player', online: 'Online',
  summary: 'Summary', steps: 'Steps', payout: 'Payout', tips: 'Tips', caveats: 'Caveats',
  reportedBy: 'Reported by', sources: 'Sources', carDupe: 'Car duplication flag',
};

/* Required by the project owner for commits created by this tool. */
const COMMIT_TRAILER = 'Co-authored-by: Perplexity <noreply@perplexity.ai>';

const LINK_TIMEOUT_MS = 12000;
const LINK_CONCURRENCY = 8;

/* ---------------------------------------------------------------------------
   Command line options
   --------------------------------------------------------------------------- */
function parseArgs(argv) {
  const opts = { dryRun: false, stamp: true, asOf: null, build: null, checkLinks: false, commit: true, message: null, compact: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new StepError('Option ' + a + ' needs a value.', 'Example: ' + a + ' "value". Run with --help to see all options.', 1);
      return v;
    };
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-stamp') opts.stamp = false;
    else if (a === '--as-of') opts.asOf = next();
    else if (a === '--build') opts.build = next();
    else if (a === '--check-links') opts.checkLinks = true;
    else if (a === '--no-commit') opts.commit = false;
    else if (a === '--message') opts.message = next();
    else if (a === '--compact') opts.compact = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new StepError('Unknown option: ' + a, 'Run with --help to see all options.', 1);
  }
  return opts;
}

function printHelp() {
  const src = fs.readFileSync(__filename, 'utf8');
  const start = src.indexOf('HOW TO RUN');
  const end = src.indexOf('STEPS (shown live');
  console.log('GTA VI tracker update script\n\n   ' + src.slice(start, end).trimEnd() + '\n');
}

/* ---------------------------------------------------------------------------
   Errors and progress display
   --------------------------------------------------------------------------- */
class StepError extends Error {
  /* message: what went wrong. hint: how to fix it. code: process exit code. */
  constructor(message, hint, code) {
    super(message);
    this.hint = hint || '';
    this.code = code || 2;
  }
}

const STEPS = [
  { name: 'Preflight checks' },
  { name: 'Load tracker data' },
  { name: 'Validate tracker data' },
  { name: 'Stamp date and build' },
  { name: 'Generate data.js' },
  { name: 'Generate CSV' },
  { name: 'Self-test generated files' },
  { name: 'Build change report' },
  { name: 'Check source links' },
  { name: 'Commit to git' },
];
STEPS.forEach((s, i) => { s.n = i + 1; s.state = 'pending'; s.note = ''; s.ms = 0; });

const MARK = { pending: '[ ]', running: '[>]', done: '[x]', skipped: '[-]', failed: '[!]' };
const LABEL = { pending: 'remaining', running: 'IN PROGRESS', done: 'completed', skipped: 'skipped', failed: 'FAILED' };
const RULE = '-'.repeat(72);
let COMPACT = false;
const warnings = [];

function board() {
  STEPS.forEach((s) => {
    const time = s.state === 'done' ? ' (' + (s.ms / 1000).toFixed(2) + 's)' : '';
    const note = s.note ? '  ' + s.note : '';
    console.log('  ' + MARK[s.state] + ' ' + String(s.n).padStart(2) + '. ' + s.name.padEnd(28) + LABEL[s.state] + time + note);
  });
}

function counts() {
  const c = { done: 0, skipped: 0, pending: 0, failed: 0, running: 0 };
  STEPS.forEach((s) => { c[s.state]++; });
  return c;
}

function info(msg) { console.log('      ' + msg); }
function warn(msg) { warnings.push(msg); console.log('      WARNING: ' + msg); }

/* Runs one step: prints progress, times it, records the outcome. */
async function runStep(index, fn) {
  const step = STEPS[index];
  step.state = 'running';
  const c = counts();
  console.log('\n' + RULE);
  console.log('STEP ' + step.n + ' of ' + STEPS.length + ': ' + step.name);
  console.log('Completed: ' + (c.done + c.skipped) + '   In progress: step ' + step.n + '   Remaining after this: ' + c.pending);
  if (!COMPACT) { console.log(RULE); board(); }
  console.log(RULE);
  const t0 = Date.now();
  try {
    const result = await fn(step);
    step.ms = Date.now() - t0;
    if (step.state === 'running') step.state = 'done';
    console.log('   -> Step ' + step.n + ' ' + LABEL[step.state] + (step.note ? ': ' + step.note : '') + '.');
    return result;
  } catch (err) {
    step.ms = Date.now() - t0;
    step.state = 'failed';
    throw err;
  }
}

function skip(step, reason) {
  step.state = 'skipped';
  step.note = reason;
}

/* ---------------------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------------------- */
function isString(v) { return typeof v === 'string'; }
function filled(v) { return isString(v) && v.trim().length > 0; }

function readText(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new StepError('Cannot read ' + what + ' at ' + file + ' (' + err.code + ').', 'Check that the file exists and is readable. Run the script from the tracker folder.', 2);
  }
}

/* Writes a file through a temporary file so a crash never leaves it half written. */
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e) { /* nothing to clean up */ }
    throw new StepError('Cannot write ' + file + ' (' + err.code + ').', 'Check free disk space and folder permissions.', 2);
  }
}

function todayLabel() {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
}

/* Replaces {build} and {asOf} in every string of a value (deep). */
function fillPlaceholders(value, meta) {
  if (isString(value)) return value.replace(/\{build\}/g, meta.build).replace(/\{asOf\}/g, meta.asOf);
  if (Array.isArray(value)) return value.map((v) => fillPlaceholders(v, meta));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = fillPlaceholders(value[k], meta); });
    return out;
  }
  return value;
}

/* Finds [[sourceKey|label]] links inside a text. */
function linkTokens(text) {
  const keys = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) keys.push(m[1]);
  const leftover = text.replace(re, '');
  return { keys, malformed: leftover.indexOf('[[') !== -1 || leftover.indexOf(']]') !== -1 };
}

/* Loads a data.js text the way a browser would and returns window.TRACKER. */
function loadDataJs(code, label) {
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(code, sandbox, { filename: label, timeout: 5000 });
  } catch (err) {
    throw new StepError(label + ' does not run: ' + err.message, 'This is a generator problem, not a data problem. Re-run with --dry-run and report the message.', 2);
  }
  if (!sandbox.window.TRACKER) throw new StepError(label + ' did not define window.TRACKER.', 'The generated file is incomplete. Re-run the script.', 2);
  return sandbox.window.TRACKER;
}

/* Minimal CSV reader used only to double check the export. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* handled with the following \n */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function git(args, options) {
  return execFileSync('git', args, Object.assign({ cwd: SITE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, options || {})).trim();
}

function gitAvailable() {
  try { return git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch (err) { return false; }
}

/* ---------------------------------------------------------------------------
   Step 3: validation
   --------------------------------------------------------------------------- */
function validate(data) {
  const errors = [];
  const err = (where, msg) => errors.push(where + ': ' + msg);

  ['meta', 'defaults', 'sources', 'entries', 'ladder'].forEach((k) => {
    if (data[k] === undefined || data[k] === null) err('top level', 'missing "' + k + '"');
  });
  if (errors.length) return errors;

  /* meta */
  ['asOf', 'build', 'platformsLive'].forEach((k) => { if (!filled(data.meta[k])) err('meta.' + k, 'must be a non-empty text'); });

  /* sources */
  const sourceKeys = Object.keys(data.sources);
  const seenUrl = {};
  sourceKeys.forEach((key) => {
    const s = data.sources[key];
    const where = 'sources.' + key;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) err(where, 'key may only contain letters and digits and must start with a letter');
    if (!s || !filled(s.name)) err(where, 'needs a "name"');
    if (!s || !filled(s.url)) { err(where, 'needs a "url"'); return; }
    try {
      const u = new URL(s.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') err(where, 'url must start with https:// (got ' + u.protocol + ')');
    } catch (e) {
      err(where, 'url is not a valid address: ' + s.url);
    }
    if (seenUrl[s.url]) warn('sources.' + key + ' and sources.' + seenUrl[s.url] + ' point to the same URL.');
    seenUrl[s.url] = key;
  });
  const hasSource = (k) => Object.prototype.hasOwnProperty.call(data.sources, k);
  const used = {};
  const checkSources = (where, list) => {
    if (!Array.isArray(list)) { err(where, '"sources" must be a list of source keys'); return; }
    list.forEach((k) => { if (!hasSource(k)) err(where, 'unknown source key "' + k + '". Add it under "sources" first.'); else used[k] = true; });
  };
  const checkRichText = (where, text) => {
    if (!filled(text)) { err(where, 'must be a non-empty text'); return; }
    const t = linkTokens(text);
    if (t.malformed) err(where, 'has a broken link. Links look like [[sourceKey|visible text]].');
    t.keys.forEach((k) => { if (!hasSource(k)) err(where, 'links to unknown source key "' + k + '"'); else used[k] = true; });
  };

  /* entries */
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    err('entries', 'must be a non-empty list');
    return errors;
  }
  const d = data.defaults;
  const ids = {};
  data.entries.forEach((e, i) => {
    const where = 'entries[' + i + ']' + (e && e.id ? ' (' + e.id + ')' : '');
    if (!e || typeof e !== 'object') { err(where, 'must be an object'); return; }
    if (!filled(e.id) || !/^[A-Z]-\d{2,3}$/.test(e.id)) err(where, '"id" must look like M-01');
    else if (ids[e.id]) err(where, 'duplicate id, already used by entries[' + ids[e.id].index + ']');
    else ids[e.id] = { index: i };
    if (!filled(e.name)) err(where, 'needs a "name"');
    if (!filled(e.summary)) err(where, 'needs a "summary"');

    const pick = (k) => (e[k] !== undefined ? e[k] : d[k]);
    const oneOf = (field, list, value) => {
      if (list.indexOf(value) === -1) err(where, '"' + field + '" is "' + value + '" but must be one of: ' + list.join(', '));
    };
    oneOf('category', ALLOWED.category, e.category);
    oneOf('repro', ALLOWED.repro, e.repro);
    oneOf('status', ALLOWED.status, pick('status'));
    oneOf('ps5', ALLOWED.platform, pick('ps5'));
    oneOf('xbox', ALLOWED.platform, pick('xbox'));
    oneOf('pc', ALLOWED.platform, pick('pc'));
    oneOf('sp', ALLOWED.sp, pick('sp'));
    oneOf('online', ALLOWED.online, pick('online'));

    const rank = pick('moneyRank');
    if (!Number.isInteger(rank) || rank < 1) err(where, '"moneyRank" must be a whole number of 1 or more');
    if (e.steps !== undefined && (!Array.isArray(e.steps) || e.steps.some((s) => !filled(s)))) err(where, '"steps" must be a list of non-empty texts');
    ['money', 'payout', 'tips', 'caveats', 'reportedBy'].forEach((k) => {
      if (e[k] !== undefined && !isString(e[k])) err(where, '"' + k + '" must be text');
    });
    if (e.carDupe !== undefined && typeof e.carDupe !== 'boolean') err(where, '"carDupe" must be true or false');
    if (!Array.isArray(e.sources) || e.sources.length === 0) err(where, 'needs at least one source key in "sources"');
    else checkSources(where, e.sources);

    Object.keys(e).forEach((k) => { if (ENTRY_FIELDS.indexOf(k) === -1) err(where, 'unknown field "' + k + '"'); });

    if (filled(e.id) && ID_PREFIX[e.id[0]] && ALLOWED.category.indexOf(e.category) !== -1 && ID_PREFIX[e.id[0]].indexOf(e.category) === -1) {
      warn(e.id + ' has category "' + e.category + '", which does not match its ID prefix.');
    }
  });

  /* ladder (legitimate earners table) */
  if (!Array.isArray(data.ladder)) err('ladder', 'must be a list');
  else data.ladder.forEach((r, i) => {
    const where = 'ladder[' + i + ']';
    ['stage', 'method', 'payout', 'note'].forEach((k) => { if (!filled(r[k])) err(where, 'needs "' + k + '"'); });
    checkSources(where, r.sources);
  });

  /* plan (money plan by chapter), optional */
  if (data.plan !== undefined) {
    if (!Array.isArray(data.plan)) err('plan', 'must be a list');
    else data.plan.forEach((p, i) => {
      const where = 'plan[' + i + ']';
      ['stage', 'title', 'expect', 'watch'].forEach((k) => { if (!filled(p[k])) err(where, 'needs "' + k + '"'); });
      if (!Array.isArray(p.do) || p.do.length === 0 || p.do.some((s) => !filled(s))) err(where, '"do" must be a non-empty list of texts');
      if (!Array.isArray(p.exploits)) err(where, '"exploits" must be a list of entry ids (it may be empty)');
      else p.exploits.forEach((id) => { if (!ids[id]) err(where, 'refers to entry "' + id + '", which does not exist'); });
      checkSources(where, p.sources);
    });
  }

  /* findings (the three cards at the top), optional */
  if (data.findings !== undefined) {
    if (!Array.isArray(data.findings)) err('findings', 'must be a list');
    else data.findings.forEach((f, i) => {
      const where = 'findings[' + i + ']';
      if (!filled(f.title)) err(where, 'needs a "title"');
      if (!Array.isArray(f.paragraphs) || f.paragraphs.length === 0) err(where, 'needs "paragraphs"');
      else f.paragraphs.forEach((p, j) => checkRichText(where + '.paragraphs[' + j + ']', p));
    });
  }

  /* footnotes, optional */
  if (data.footnotes !== undefined) {
    if (!Array.isArray(data.footnotes)) err('footnotes', 'must be a list');
    else data.footnotes.forEach((p, j) => checkRichText('footnotes[' + j + ']', p));
  }

  sourceKeys.forEach((k) => { if (!used[k]) warn('sources.' + k + ' is not used by any entry, table or note.'); });
  return errors;
}

/* ---------------------------------------------------------------------------
   Step 5: build the object the website loads and wrap it in data.js
   --------------------------------------------------------------------------- */
function resolveData(data) {
  const d = data.defaults;
  const entries = data.entries.map((e) => {
    const pick = (k, fallback) => (e[k] !== undefined ? e[k] : (d[k] !== undefined ? d[k] : fallback));
    return {
      id: e.id,
      name: e.name,
      category: e.category,
      moneyRank: pick('moneyRank', 99),
      money: pick('money', 'None'),
      ps5: pick('ps5', 'Unspecified'),
      xbox: pick('xbox', 'Unspecified'),
      pc: pick('pc', 'Not released'),
      repro: e.repro,
      status: pick('status', 'Unpatched'),
      sp: pick('sp', 'Yes'),
      online: pick('online', 'No online mode'),
      summary: e.summary,
      steps: e.steps || [],
      payout: pick('payout', ''),
      tips: pick('tips', ''),
      caveats: pick('caveats', ''),
      reportedBy: pick('reportedBy', ''),
      sources: e.sources,
      carDupe: e.carDupe === true,
    };
  });
  const resolved = {
    meta: data.meta,
    sources: data.sources,
    entries,
    ladder: data.ladder,
    plan: data.plan || [],
    findings: data.findings || [],
    footnotes: data.footnotes || [],
  };
  return fillPlaceholders(resolved, data.meta);
}

/* The CSV code is written into data.js so the website's "Export CSV" button and
   the CSV file on disk always come from exactly the same code. */
const CSV_CODE = `
  var CSV_COLUMNS = [
    ['ID', function (e) { return e.id; }],
    ['Glitch', function (e) { return e.name; }],
    ['Category', function (e) { return e.category; }],
    ['Money potential', function (e) { return e.money; }],
    ['PS5', function (e) { return e.ps5; }],
    ['Xbox Series X|S', function (e) { return e.xbox; }],
    ['PC', function (e) { return e.pc; }],
    ['Reproducibility', function (e) { return e.repro; }],
    ['Patch status', function (e) { return e.status; }],
    ['Single-player', function (e) { return e.sp; }],
    ['Online', function (e) { return e.online; }],
    ['Summary', function (e) { return e.summary; }],
    ['Steps or trigger', function (e) { return e.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join(' '); }],
    ['Payout', function (e) { return e.payout; }],
    ['Tips', function (e) { return e.tips; }],
    ['Caveats', function (e) { return e.caveats; }],
    ['Reported by', function (e) { return e.reportedBy; }],
    ['Source URLs', function (e) { return e.sources.map(function (k) { return DATA.sources[k].url; }).join(' | '); }],
  ];

  function toCsv(rows) {
    function cell(v) {
      var s = String(v == null ? '' : v);
      return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [CSV_COLUMNS.map(function (c) { return cell(c[0]); }).join(',')];
    rows.forEach(function (e) {
      lines.push(CSV_COLUMNS.map(function (c) { return cell(c[1](e)); }).join(','));
    });
    return lines.join('\\r\\n') + '\\r\\n';
  }
`;
const CSV_COLUMN_COUNT = 18;

function renderDataJs(resolved) {
  const json = JSON.stringify(resolved, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return [
    '/* GENERATED FILE. Do not edit by hand.',
    '   Edit tracker-data.json, then run: node update-tracker.js',
    '   Loaded by index.html in the browser (window) and by the update script in Node. */',
    '(function (root) {',
    "  'use strict';",
    '',
    '  var DATA = ' + json.replace(/\n/g, '\n  ') + ';',
    CSV_CODE,
    '  DATA.toCsv = toCsv;',
    '  root.TRACKER = DATA;',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
}

/* ---------------------------------------------------------------------------
   Step 8: change report
   --------------------------------------------------------------------------- */
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function buildReport(previous, current, options) {
  const report = {
    generatedAt: new Date().toISOString(),
    asOf: current.meta.asOf,
    build: current.meta.build,
    comparedWith: previous ? 'last git commit' : 'nothing (first run or no git history)',
    dryRun: options.dryRun,
    totals: { entries: current.entries.length },
    hasChanges: false,
    added: [], removed: [], changed: [],
    metaChanges: [],
    alerts: { carDuplicationVerified: [], newlyPatched: [], buildChanged: false },
    otherSectionsChanged: [],
    warnings: warnings.slice(),
  };

  const isVerifiedDupe = (e) => e.carDupe === true && e.repro === 'Repeatable' && ['Unverified', 'Not real'].indexOf(e.status) === -1;
  const isPatched = (e) => e.status === 'Patched' || e.status === 'Partially patched';
  report.totals.verifiedCarDuplication = current.entries.filter(isVerifiedDupe).length;
  report.totals.patched = current.entries.filter(isPatched).length;

  if (!previous) {
    report.hasChanges = true;
    return report;
  }

  const before = {};
  previous.entries.forEach((e) => { before[e.id] = e; });
  const after = {};
  current.entries.forEach((e) => { after[e.id] = e; });

  current.entries.forEach((e) => {
    const old = before[e.id];
    if (!old) {
      report.added.push({ id: e.id, name: e.name, category: e.category, status: e.status, repro: e.repro });
      if (isVerifiedDupe(e)) report.alerts.carDuplicationVerified.push({ id: e.id, name: e.name });
      if (isPatched(e)) report.alerts.newlyPatched.push({ id: e.id, name: e.name, status: e.status });
      return;
    }
    const fields = [];
    Object.keys(TRACKED_FIELDS).forEach((k) => {
      const was = old[k] === undefined && k === 'carDupe' ? false : old[k];
      if (!same(was, e[k])) {
        const short = ['summary', 'steps', 'payout', 'tips', 'caveats', 'sources', 'reportedBy'].indexOf(k) !== -1;
        fields.push(short ? { field: TRACKED_FIELDS[k] } : { field: TRACKED_FIELDS[k], from: was, to: e[k] });
      }
    });
    if (fields.length) report.changed.push({ id: e.id, name: e.name, fields });
    if (isVerifiedDupe(e) && !isVerifiedDupe(old)) report.alerts.carDuplicationVerified.push({ id: e.id, name: e.name });
    if (isPatched(e) && !isPatched(old)) report.alerts.newlyPatched.push({ id: e.id, name: e.name, status: e.status });
  });
  previous.entries.forEach((e) => { if (!after[e.id]) report.removed.push({ id: e.id, name: e.name }); });

  Object.keys(current.meta).forEach((k) => {
    const was = (previous.meta || {})[k];
    if (was !== current.meta[k]) report.metaChanges.push({ field: k, from: was === undefined ? null : was, to: current.meta[k] });
  });
  report.alerts.buildChanged = (previous.meta || {}).build !== current.meta.build;

  [['ladder', 'Legitimate earners table'], ['plan', 'Money plan'], ['findings', 'Key findings'], ['footnotes', 'Footnotes'], ['sources', 'Source list']].forEach((pair) => {
    if (!same(previous[pair[0]] === undefined ? (pair[0] === 'sources' ? {} : []) : previous[pair[0]], current[pair[0]])) report.otherSectionsChanged.push(pair[1]);
  });

  const onlyDate = report.metaChanges.length === 1 && report.metaChanges[0].field === 'asOf';
  report.hasContentChanges = report.added.length + report.removed.length + report.changed.length + report.otherSectionsChanged.length > 0 || (report.metaChanges.length > 0 && !onlyDate);
  report.hasChanges = report.hasContentChanges || report.metaChanges.length > 0;
  return report;
}

function printReport(report) {
  info('Compared with: ' + report.comparedWith);
  info('Entries: ' + report.totals.entries + '   Patched: ' + report.totals.patched + '   Verified car duplication methods: ' + report.totals.verifiedCarDuplication);
  if (report.comparedWith.indexOf('nothing') === 0) return;
  info('Added: ' + report.added.length + '   Removed: ' + report.removed.length + '   Changed: ' + report.changed.length);
  report.added.forEach((e) => info('  + ' + e.id + ' ' + e.name + ' [' + e.category + ', ' + e.repro + ', ' + e.status + ']'));
  report.removed.forEach((e) => info('  - ' + e.id + ' ' + e.name));
  report.changed.forEach((e) => {
    const parts = e.fields.map((f) => (f.from !== undefined ? f.field + ': ' + JSON.stringify(f.from) + ' -> ' + JSON.stringify(f.to) : f.field + ' edited'));
    info('  ~ ' + e.id + ' ' + e.name + ': ' + parts.join('; '));
  });
  report.metaChanges.forEach((m) => info('  meta.' + m.field + ': ' + JSON.stringify(m.from) + ' -> ' + JSON.stringify(m.to)));
  if (report.otherSectionsChanged.length) info('Other sections edited: ' + report.otherSectionsChanged.join(', '));
  if (report.alerts.carDuplicationVerified.length) info('ALERT: car duplication verified: ' + report.alerts.carDuplicationVerified.map((e) => e.id).join(', '));
  if (report.alerts.newlyPatched.length) info('ALERT: newly patched: ' + report.alerts.newlyPatched.map((e) => e.id + ' (' + e.status + ')').join(', '));
  if (report.alerts.buildChanged) info('ALERT: game build changed to ' + report.build);
  if (!report.hasChanges) info('No differences from the last commit.');
}

/* ---------------------------------------------------------------------------
   Step 9: link check
   --------------------------------------------------------------------------- */
async function checkOne(key, source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      method: 'GET', redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; gta6-tracker-link-check/1.0)', accept: 'text/html,*/*' },
    });
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* body already closed */ }
    if (res.status < 400) return { key, url: source.url, result: 'ok', status: res.status };
    if ([401, 403, 429, 999].indexOf(res.status) !== -1) return { key, url: source.url, result: 'blocked', status: res.status };
    return { key, url: source.url, result: 'broken', status: res.status };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timed out after ' + LINK_TIMEOUT_MS / 1000 + 's' : ((err.cause && err.cause.code) || err.message);
    return { key, url: source.url, result: 'error', status: null, reason };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLinks(sources) {
  const keys = Object.keys(sources);
  const results = [];
  let next = 0;
  let finished = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      const r = await checkOne(key, sources[key]);
      results.push(r);
      finished++;
      if (finished % 10 === 0 || finished === keys.length) info('Checked ' + finished + ' of ' + keys.length + ' links...');
    }
  }
  await Promise.all(Array.from({ length: Math.min(LINK_CONCURRENCY, keys.length) }, worker));
  return results;
}

/* ---------------------------------------------------------------------------
   Main
   --------------------------------------------------------------------------- */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return 0; }
  COMPACT = opts.compact;

  console.log(RULE);
  console.log('GTA VI tracker update' + (opts.dryRun ? '  (DRY RUN: nothing will be written)' : ''));
  console.log('Folder: ' + SITE_DIR);
  console.log('Started: ' + new Date().toISOString());
  console.log(RULE);

  /* Previous file contents, kept in memory so a late failure can be undone. */
  const backup = {};
  let wroteFiles = false;
  const restore = () => {
    if (!wroteFiles) return false;
    Object.keys(backup).forEach((file) => {
      try {
        if (backup[file] === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else fs.writeFileSync(file, backup[file]);
      } catch (e) {
        console.log('      Could not restore ' + file + ': ' + e.message);
      }
    });
    return true;
  };
  const remember = (file) => { if (!(file in backup)) backup[file] = fs.existsSync(file) ? fs.readFileSync(file) : null; };

  let rawJson;
  let data;
  let resolved;
  let dataJsText;
  let csvText;
  let report;
  let hasGit = false;

  try {
    /* ---- Step 1 ---- */
    await runStep(0, (step) => {
      const major = parseInt(process.versions.node.split('.')[0], 10);
      if (major < 18) throw new StepError('Node.js ' + process.versions.node + ' is too old.', 'Install Node.js 18 or newer from https://nodejs.org and run again.', 2);
      info('Node.js ' + process.versions.node + ' OK');
      [['json', 'tracker-data.json'], ['appJs', 'app.js'], ['indexHtml', 'index.html']].forEach((p) => {
        if (!fs.existsSync(PATHS[p[0]])) throw new StepError('Missing file: ' + PATHS[p[0]], 'The script must sit in the tracker folder next to ' + p[1] + '.', 2);
        info('Found ' + p[1]);
      });
      hasGit = gitAvailable();
      info(hasGit ? 'Git repository found' : 'No git repository here (change report and commit will be limited)');
      step.note = 'environment ready';
    });

    /* ---- Step 2 ---- */
    await runStep(1, (step) => {
      rawJson = readText(PATHS.json, 'tracker-data.json');
      try {
        data = JSON.parse(rawJson);
      } catch (err) {
        const m = /position (\d+)/.exec(err.message);
        let whereText = '';
        if (m) {
          const upTo = rawJson.slice(0, Number(m[1]));
          whereText = ' Near line ' + upTo.split('\n').length + ', column ' + (upTo.length - upTo.lastIndexOf('\n')) + '.';
        }
        throw new StepError('tracker-data.json is not valid JSON: ' + err.message + '.' + whereText, 'Common causes: a missing or extra comma, a missing quote, or an unescaped " inside a text (write \\" instead).', 1);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StepError('tracker-data.json must contain one object.', 'Restore the file from git: git checkout tracker-data.json', 1);
      const n = Array.isArray(data.entries) ? data.entries.length : 0;
      info('Read ' + (rawJson.length / 1024).toFixed(1) + ' KB, ' + n + ' entries, ' + Object.keys(data.sources || {}).length + ' sources');
      step.note = n + ' entries loaded';
    });

    /* ---- Step 3 ---- */
    await runStep(2, (step) => {
      const errors = validate(data);
      if (errors.length) {
        console.log('      Found ' + errors.length + ' problem' + (errors.length === 1 ? '' : 's') + ':');
        errors.forEach((e, i) => console.log('        ' + (i + 1) + '. ' + e));
        throw new StepError(errors.length + ' data problem' + (errors.length === 1 ? '' : 's') + ' in tracker-data.json.', 'Fix the lines listed above in tracker-data.json and run the script again. Nothing was changed.', 1);
      }
      const byCategory = {};
      data.entries.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + 1; });
      Object.keys(byCategory).forEach((c) => info(String(byCategory[c]).padStart(3) + '  ' + c));
      step.note = 'no errors' + (warnings.length ? ', ' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's') : '');
    });

    /* ---- Step 4 ---- */
    await runStep(3, (step) => {
      const before = { asOf: data.meta.asOf, build: data.meta.build };
      if (opts.asOf) data.meta.asOf = opts.asOf;
      else if (opts.stamp) data.meta.asOf = todayLabel();
      if (opts.build) data.meta.build = opts.build;
      info('Checked date: ' + before.asOf + (before.asOf === data.meta.asOf ? ' (unchanged)' : ' -> ' + data.meta.asOf));
      info('Game build:   ' + before.build + (before.build === data.meta.build ? ' (unchanged)' : ' -> ' + data.meta.build));
      const changed = before.asOf !== data.meta.asOf || before.build !== data.meta.build;
      if (changed && !opts.dryRun) {
        remember(PATHS.json);
        wroteFiles = true;
        writeAtomic(PATHS.json, JSON.stringify(data, null, 2) + '\n');
        info('Saved the new values to tracker-data.json');
      }
      step.note = changed ? (opts.dryRun ? 'would update' : 'updated') : 'no change needed';
    });

    /* ---- Step 5 ---- */
    await runStep(4, (step) => {
      resolved = resolveData(data);
      dataJsText = renderDataJs(resolved);
      info('Filled defaults for ' + resolved.entries.length + ' entries');
      info('data.js size: ' + (dataJsText.length / 1024).toFixed(1) + ' KB');
      if (opts.dryRun) { step.note = 'built in memory only'; return; }
      remember(PATHS.dataJs);
      wroteFiles = true;
      writeAtomic(PATHS.dataJs, dataJsText);
      step.note = 'wrote data.js';
    });

    /* ---- Step 6 ---- */
    await runStep(5, (step) => {
      const tracker = loadDataJs(dataJsText, 'data.js');
      csvText = '\ufeff' + tracker.toCsv(tracker.entries);
      info('CSV rows: ' + tracker.entries.length + ' plus header, ' + (csvText.length / 1024).toFixed(1) + ' KB');
      if (opts.dryRun) { step.note = 'built in memory only'; return; }
      remember(PATHS.csv);
      wroteFiles = true;
      writeAtomic(PATHS.csv, csvText);
      step.note = 'wrote ' + path.basename(PATHS.csv);
    });

    /* ---- Step 7 ---- */
    await runStep(6, (step) => {
      const checks = [];
      const check = (label, ok, detail) => {
        checks.push(ok);
        info((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' (' + detail + ')' : ''));
      };
      const onDisk = opts.dryRun ? dataJsText : readText(PATHS.dataJs, 'data.js');
      const tracker = loadDataJs(onDisk, 'data.js');
      check('data.js loads and defines TRACKER', true);
      check('entry count matches the source', tracker.entries.length === data.entries.length, tracker.entries.length + ' entries');
      const incomplete = tracker.entries.filter((e) => ENTRY_FIELDS.some((k) => e[k] === undefined));
      check('every entry has every field', incomplete.length === 0, incomplete.length ? incomplete.map((e) => e.id).join(', ') : ENTRY_FIELDS.length + ' fields each');
      const leftover = JSON.stringify(tracker).match(/\{(build|asOf)\}/);
      check('no unfilled {build} or {asOf} placeholders', !leftover);
      const csvOnDisk = opts.dryRun ? csvText : readText(PATHS.csv, 'the CSV');
      check('CSV starts with a byte order mark for Excel', csvOnDisk.charCodeAt(0) === 0xfeff);
      const rows = parseCsv(csvOnDisk.slice(1));
      check('CSV has one row per entry plus a header', rows.length === data.entries.length + 1, rows.length + ' rows');
      const badWidth = rows.filter((r) => r.length !== CSV_COLUMN_COUNT).length;
      check('every CSV row has ' + CSV_COLUMN_COUNT + ' columns', badWidth === 0, badWidth ? badWidth + ' rows differ' : '');
      check('CSV IDs match the data', rows.slice(1).every((r, i) => r[0] === data.entries[i].id));
      try {
        new vm.Script(readText(PATHS.appJs, 'app.js'), { filename: 'app.js' });
        check('app.js has no syntax errors', true);
      } catch (err) {
        check('app.js has no syntax errors', false, err.message);
      }
      const html = readText(PATHS.indexHtml, 'index.html');
      check('index.html loads data.js and app.js', html.indexOf('src="data.js"') !== -1 && html.indexOf('src="app.js"') !== -1);
      const failed = checks.filter((ok) => !ok).length;
      if (failed) throw new StepError(failed + ' self-test check' + (failed === 1 ? '' : 's') + ' failed.', 'See the FAIL lines above. The previous files are restored automatically.', 2);
      step.note = checks.length + ' checks passed';
    });

    /* ---- Step 8 ---- */
    await runStep(7, (step) => {
      let previous = null;
      if (hasGit) {
        try {
          previous = loadDataJs(git(['show', 'HEAD:data.js'], { maxBuffer: 64 * 1024 * 1024 }), 'data.js from the last commit');
        } catch (err) {
          info('No earlier data.js in git to compare with (' + String(err.message).split('\n')[0] + ')');
        }
      }
      report = buildReport(previous, resolved, opts);
      printReport(report);
      if (!opts.dryRun) {
        writeAtomic(PATHS.report, JSON.stringify(report, null, 2) + '\n');
        info('Saved the report to ' + PATHS.report);
      }
      step.note = report.hasChanges ? (report.added.length + ' added, ' + report.removed.length + ' removed, ' + report.changed.length + ' changed') : 'no differences';
    });

    /* ---- Step 9 ---- */
    await runStep(8, async (step) => {
      if (!opts.checkLinks) { skip(step, 'run with --check-links to enable'); return; }
      if (typeof fetch !== 'function') { skip(step, 'this Node.js version has no fetch'); return; }
      const results = await checkLinks(data.sources);
      const group = (name) => results.filter((r) => r.result === name);
      info('OK: ' + group('ok').length + '   Blocked by the site: ' + group('blocked').length + '   Broken: ' + group('broken').length + '   No response: ' + group('error').length);
      group('broken').forEach((r) => warn('Broken link (HTTP ' + r.status + '): ' + r.key + ' ' + r.url));
      group('error').forEach((r) => warn('No response (' + r.reason + '): ' + r.key + ' ' + r.url));
      group('blocked').forEach((r) => info('Blocked (HTTP ' + r.status + ', usually bot protection, the link is probably fine): ' + r.key));
      if (report) {
        report.linkCheck = { ok: group('ok').length, blocked: group('blocked').map((r) => r.key), broken: group('broken').map((r) => r.key), noResponse: group('error').map((r) => r.key) };
        report.warnings = warnings.slice();
        if (!opts.dryRun) writeAtomic(PATHS.report, JSON.stringify(report, null, 2) + '\n');
      }
      step.note = group('ok').length + ' ok, ' + (group('broken').length + group('error').length) + ' need a look';
    });

    /* ---- Step 10 ---- */
    await runStep(9, (step) => {
      if (opts.dryRun) { skip(step, 'dry run'); return; }
      if (!opts.commit) { skip(step, '--no-commit was given'); return; }
      if (!hasGit) { skip(step, 'no git repository in this folder'); return; }
      try {
        git(['add', '-A']);
        let staged = '';
        try { git(['diff', '--cached', '--quiet']); } catch (e) { staged = git(['diff', '--cached', '--name-only']); }
        if (!staged) { skip(step, 'nothing changed since the last commit'); return; }
        info('Files in this commit: ' + staged.split('\n').join(', '));
        const subject = opts.message || 'Update tracker data (' + data.meta.asOf + ')';
        const body = [];
        if (report) {
          body.push('Entries: ' + report.totals.entries + '. Added ' + report.added.length + ', removed ' + report.removed.length + ', changed ' + report.changed.length + '.');
          report.added.forEach((e) => body.push('+ ' + e.id + ' ' + e.name));
          report.removed.forEach((e) => body.push('- ' + e.id + ' ' + e.name));
          report.changed.slice(0, 30).forEach((e) => body.push('~ ' + e.id + ': ' + e.fields.map((f) => f.field).join(', ')));
        }
        git(['commit', '-q', '-m', subject, '-m', body.join('\n') || 'Rebuilt generated files.', '-m', COMMIT_TRAILER]);
        const hash = git(['rev-parse', '--short', 'HEAD']);
        info('Created commit ' + hash + ': ' + subject);
        step.note = 'commit ' + hash;
      } catch (err) {
        const detail = String((err.stderr && err.stderr.toString()) || err.message).trim().split('\n').slice(-3).join(' | ');
        throw new StepError('Git commit failed: ' + detail, 'The rebuilt files are fine and stay in place. If git asks who you are, run: git config user.name "Your Name" and git config user.email "you@example.com". Or run again with --no-commit.', 2);
      }
    });
  } catch (err) {
    const failed = STEPS.find((s) => s.state === 'failed');
    /* A failed commit must not undo a good rebuild. Everything else is rolled back. */
    const keepFiles = failed && failed.n === 10;
    const restored = keepFiles ? false : restore();
    console.log('\n' + RULE);
    console.log('STOPPED' + (failed ? ' at step ' + failed.n + ' (' + failed.name + ')' : ''));
    console.log(RULE);
    console.log('Problem: ' + (err && err.message ? err.message : String(err)));
    if (err instanceof StepError && err.hint) console.log('How to fix: ' + err.hint);
    if (!(err instanceof StepError)) {
      console.log('How to fix: this was not expected. The details below help with troubleshooting.');
      console.log(err && err.stack ? err.stack : err);
    }
    console.log(restored ? 'Rollback: the previous data.js, CSV and tracker-data.json were restored.' : (keepFiles ? 'Rollback: not needed. The rebuilt files were kept.' : 'Rollback: not needed. No files had been changed.'));
    console.log('\nStep summary:');
    board();
    const c = counts();
    console.log('\nCompleted: ' + c.done + '   Skipped: ' + c.skipped + '   Failed: ' + c.failed + '   Not reached: ' + c.pending);
    return err instanceof StepError ? err.code : 2;
  }

  /* ---- Final summary ---- */
  console.log('\n' + RULE);
  console.log(opts.dryRun ? 'DRY RUN FINISHED: the data is valid, nothing was written' : 'FINISHED');
  console.log(RULE);
  board();
  const c = counts();
  console.log('\nCompleted: ' + c.done + '   Skipped: ' + c.skipped + '   Failed: 0   Remaining: 0');
  if (warnings.length) {
    console.log('\nWarnings (' + warnings.length + '):');
    warnings.forEach((w, i) => console.log('  ' + (i + 1) + '. ' + w));
  }
  if (!opts.dryRun) {
    console.log('\nFiles:');
    console.log('  Website data : ' + PATHS.dataJs);
    console.log('  CSV export   : ' + PATHS.csv);
    console.log('  Change report: ' + PATHS.report);
    console.log('\nNext step: publish the website again so the live page shows the new data.');
  }
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error('\nUnexpected failure before the steps started: ' + (err && err.message ? err.message : err));
    if (err instanceof StepError && err.hint) console.error('How to fix: ' + err.hint);
    process.exitCode = err instanceof StepError ? err.code : 2;
  }
);
