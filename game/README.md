# Contribution art

Two generators that turn this profile's GitHub data into artwork committed
straight into the repo, so the README never depends on a third-party service
staying up. Both are re-rendered daily by
[`.github/workflows/update-game.yml`](../.github/workflows/update-game.yml).

- `game/` - the animated GIF (this directory)
- `stats/` - the Daily Bugle panels: `stats.svg`, `langs.svg`, `streak.svg`
  and `activity.svg`

## Scenes

`SCENE=swinger` (default) renders **Web-Swinger**: the calendar as a night
skyline with Spider-Man swinging across it.

`SCENE=runner` renders **Terminal Runner**, the original platformer, kept so it
can be switched back on at any time.

Both read the same world model:

| Contribution data           | Scene element                                  |
| --------------------------- | ---------------------------------------------- |
| One week (calendar column)  | One tower / terrain column                     |
| Days with commits that week | Its height, in blocks                          |
| A day's contribution level  | Block colour, dimmest at the bottom            |
| That week's commit total    | Added to the HUD counter as he passes          |

In **Web-Swinger** the swing arc is hung off a smoothed envelope of the local
rooftops, so a dense run of weeks pushes the arc high and a quiet stretch lets
it dip low. The anchor for each swing sits above the midpoint of that swing's
span, which is what makes the web sweep forward, go vertical, then trail behind.

In **Terminal Runner** the runner advances one week per hop and picks up a coin
on each landing.

## Running it locally

```bash
cd game
npm install
GITHUB_TOKEN=$(gh auth token) node generate.mjs Kiko915 ../game.gif

# the other scene
SCENE=runner GITHUB_TOKEN=$(gh auth token) node generate.mjs Kiko915 ../runner.gif

# stat panels (from the repo root)
GITHUB_TOKEN=$(gh auth token) node stats/generate.mjs Kiko915 .
```

Without a token the GIF falls back to scraping the public calendar fragment at
`github.com/users/<login>/contributions`, which carries levels but not always
exact per-day counts. The stat panels require a token.

Environment variables: `SCENE`, `GH_LOGIN`, `OUT_PATH`, `GITHUB_TOKEN`, and
`EXCLUDE_REPOS` (stats only). Set `DEBUG_FRAME=<n>` to write just that single
frame, which is how to tune layout without waiting on a full encode.

## Files

- `generate.mjs` - CLI entry point, picks a scene and writes the GIF
- `scene-swinger.mjs` / `scene-runner.mjs` - layout and animation per scene
- `sprites-spidey.mjs` / `sprites-runner.mjs` - pixel art
- `contributions.mjs` - calendar fetch (GraphQL, with a scrape fallback)
- `draw.mjs` - rect / sprite / line / bitmap text primitives
- `encode.mjs` - GIF encoding
- `font.mjs` - 5x7 bitmap font for the HUD and month ruler

Frames are encoded as transparent deltas against the static backdrop, which is
what keeps a 226-frame 873x259 animation under 300 KB.
