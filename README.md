# GTA Glitch Tracker

Two separate apps that share one data file and one update script.

- **Glitch Tracker** (`/`): GTA VI money exploits, duplication claims and physics glitches, with the money plan and the legitimate earners table.
- **Car Tracker** (`/cars/`): the car value list for the three in-game car buyers (Moses, Pay 'n' Spray and Randy) and a location card for every car on Randy's Wish List.

Each app links to the other from the top and the bottom of its page.

Live page: https://rolltidehero.github.io/gta-glitch-tracker/

Every entry is labelled by platform, evidence tier ("reproducibility"), patch status and game mode. Payouts, car values and car locations come from published guides and in-game scans reported by those guides. They are not measurements, nothing was checked in the game for this tracker, and the page shows where guides disagree.

## What is in here

| File | Purpose |
| --- | --- |
| `tracker-data.json` | The only file you edit by hand. Entries, sources, money plan, car buyers, cars and Wish List location cards. |
| `update-tracker.js` | One script that validates the data, rebuilds everything, tests it, commits and pushes. |
| `data.js` and `cars/data.js` | Generated from `tracker-data.json`, one per app. Do not edit. |
| `index.html`, `app.js` | The Glitch Tracker page. |
| `cars/index.html`, `cars/app.js` | The Car Tracker page. |
| `style.css`, `base.css` | Styles shared by both apps. No build step, no dependencies. |
| `exports/` | Generated CSV copies of the glitch matrix and the car value list. |

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

## Wish List location cards

Every car with `"wishList": true` in `tracker-data.json` carries a `"wish"` object, which becomes its card on the page and three columns in the car CSV:

```json
"wish": {
  "status": "Guides agree",
  "list": "Starting 16",
  "spots": [
    { "where": "Forecourt of the Sweetbay Inn, East Buckley Dr, Capri", "when": "Late at night, around 3am" },
    { "where": "Inside the Sunrise Premium Autos showroom, El Joven Blvd, northern Southside" }
  ],
  "need": "Clone Key",
  "how": "If the inn forecourt is empty, try the showroom or ask Randy for a lead.",
  "tracker": "Optional. What guides say about its tracker.",
  "caveat": "Optional. Where guides disagree. [[sourceKey|Link text]] makes a link.",
  "sources": ["pushsquareRandy", "radiotimes"]
}
```

| Field | Rule |
| --- | --- |
| `status` | An evidence tier, not a confirmation. `Guides agree` (two or more guides name the same place, so it needs at least two sources), `Reported sighting` (one guide or one player sighting), `Traffic search` (an area to scan), `No fixed spot` (nobody has located it; `spots` must be `[]`). |
| `list` | `Starting 16` or `Added by a mission`. Guides count the whole list as 16, 18 or 22 cars. |
| `spots` | The first one is shown as the main spot, the rest as alternates. `when` is optional. |
| `need`, `sources` | Required. |

The script stops with a message naming the car if a Wish List car has no card or a card breaks one of these rules.

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

`.github/workflows/refresh.yml` runs `node update-tracker.js --auto` every hour on GitHub's servers, so nothing needs to be open on any computer. It refreshes the car values from IGN, stamps the date, rebuilds, commits and pushes only when something changed, then asks GitHub Pages to rebuild. Step 13 of the script also watches a few public pages for a newer game build number and for a change in the CodeKingGTA car duplication row. It never edits glitch data. It opens a GitHub issue for a person to review instead. You can also run it by hand from the Actions tab.

Limits: a script cannot judge a new glitch write-up or verify a car duplication. Those entries still need a person to edit `tracker-data.json`.

## Footer version

The page footer shows the latest commit hash, the commit count and the commit time, read live from the GitHub API. If GitHub is unreachable or rate limited, it shows a link to the commit history instead.
