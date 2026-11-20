# GTA Glitch Tracker

This is the Glitch Tracker: GTA VI money exploits, duplication claims and physics glitches, with the money plan and the legitimate earners table. Live page: https://rolltidehero.github.io/gta-glitch-tracker/

The car value list and Randy's Wish List locations live in the separate [Car Tracker](https://github.com/rolltidehero/gta-car-tracker) repository ([live page](https://rolltidehero.github.io/gta-car-tracker/)). Each page links to the other.

Every entry is labelled by platform, evidence tier ("reproducibility"), patch status and game mode. Payouts, car values and car locations come from published guides and in-game scans reported by those guides. They are not measurements, nothing was checked in the game for this tracker, and the page shows where guides disagree.

## What is in here

| File | Purpose |
| --- | --- |
| `tracker-data.json` | The only file you edit by hand. Entries, sources, money plan and earners table. |
| `update-tracker.js` | One script that validates the data, rebuilds everything, tests it, commits and pushes. |
| `data.js` | Generated from `tracker-data.json`. Do not edit. |
| `index.html`, `app.js`, `style.css`, `base.css` | The page itself. No build step, no dependencies. |
| `exports/` | Generated CSV copy of the glitch matrix. |

## How to update

1. Edit `tracker-data.json`.
2. Run the script from this folder:

```
node update-tracker.js
```

The script prints each of its 13 steps with what is completed, in progress and remaining. It stops with a clear message if the data is invalid, and it never writes a half-built site.

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

## Car data

Car values, buyers and Wish List location cards are edited in the Car Tracker repository, not here.

## GitHub

The repository is public at https://github.com/rolltidehero/gta-glitch-tracker and GitHub Pages serves the `master` branch at https://rolltidehero.github.io/gta-glitch-tracker/.

After every commit the script pushes to the remote named `origin`, and GitHub Pages rebuilds the live page about a minute later. When nothing changed the script reports that GitHub already has the latest commit and does nothing. A failed push is reported as a warning and the local commit is kept, so the next run pushes it.

Because the page is public, keep private notes, account names and credentials out of this folder.

## Viewing the page locally

```
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Requirements

Node.js 18 or newer. No npm packages. Git is optional; pushing needs a remote named `origin`.

## Hourly automatic refresh

`.github/workflows/refresh.yml` runs `node update-tracker.js --auto` every hour on GitHub's servers, so nothing needs to be open on any computer. It stamps the date, rebuilds, commits and pushes only when something changed, then asks GitHub Pages to rebuild. Step 13 of the script also watches a few public pages for a newer game build number and for a change in the CodeKingGTA car duplication row. It never edits glitch data. It opens a GitHub issue for a person to review instead. You can also run it by hand from the Actions tab.

Limits: a script cannot judge a new glitch write-up or verify a car duplication. Those entries still need a person to edit `tracker-data.json`.

## RSS alerts

Select **Get RSS alerts!** or paste the [feed URL](https://rolltidehero.github.io/gta-glitch-tracker/feed.xml) into a feed reader. The update script generates `feed.xml` and keeps the 25 most recent items. Glitch reports, patch status, and other tracker content changes generate alerts; date-only checks do not.

## Footer version

The page footer shows the latest commit hash, the commit count and the commit time, read live from the GitHub API. If GitHub is unreachable or rate limited, it shows a link to the commit history instead.
