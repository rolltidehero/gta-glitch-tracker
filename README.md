# GTA 6 Glitch and Money Exploit Tracker

A single-page tracker for GTA VI money exploits, duplication claims and physics glitches, plus a car value list for the three in-game car buyers (Moses, Pay 'n' Spray and Randy).

Every entry is labelled by platform, evidence tier ("reproducibility"), patch status and game mode. Payouts and car values come from published guides and in-game scans reported by those guides. They are not measurements, and the page shows where guides disagree.

## What is in here

| File | Purpose |
| --- | --- |
| `tracker-data.json` | The only file you edit by hand. Entries, sources, money plan, car buyers and cars. |
| `update-tracker.js` | One script that validates the data, rebuilds everything, tests it, commits and pushes. |
| `data.js` | Generated from `tracker-data.json`. Do not edit. |
| `index.html`, `app.js`, `style.css`, `base.css` | The page itself. No build step, no dependencies. |
| `exports/` | Generated CSV copies of the glitch matrix and the car value list. |

## How to update

1. Edit `tracker-data.json`.
2. Run the script from this folder:

```
node update-tracker.js
```

The script prints each of its 12 steps with what is completed, in progress and remaining. It stops with a clear message if the data is invalid, and it never writes a half-built site.

## Options

| Option | What it does |
| --- | --- |
| `--dry-run` | Validate and test only. Writes nothing. |
| `--refresh-cars` | Pull the newest car scan values from IGN's vehicle table. A failed fetch is a warning, not an error. |
| `--check-links` | Test every source URL (slower). |
| `--build 1.003.000` | Record a new game build number. |
| `--as-of "November 25, 2026"` | Set the "Checked" date by hand. |
| `--no-stamp` | Keep the "Checked" date as it is. |
| `--no-commit` | Rebuild but do not make a git commit. |
| `--no-push` | Commit but do not push to GitHub. |
| `--message "text"` | Custom commit subject. |
| `--compact` | Shorter progress output. |
| `--help` | Show the built-in help. |

Exit codes: `0` success, `1` invalid data or failed self-test, `2` environment problem.

## GitHub

The repository is private. After every commit the script pushes to the remote named `origin`. When nothing changed it reports that GitHub already has the latest commit and does nothing. A failed push is reported as a warning and the local commit is kept, so the next run pushes it.

## Viewing the page locally

```
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Requirements

Node.js 18 or newer. No npm packages. Git is optional; pushing needs a remote named `origin`.
