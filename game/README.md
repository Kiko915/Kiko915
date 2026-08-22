# Terminal Runner

Renders the last 365 days of a GitHub contribution calendar as a side-scrolling
platformer GIF, committed back to the repo root as `game.gif` by
[`.github/workflows/update-game.yml`](../.github/workflows/update-game.yml).

## How the graph becomes a level

| Contribution data          | Game element                                    |
| -------------------------- | ----------------------------------------------- |
| One week (calendar column) | One column of terrain                           |
| Days with commits that week| Terrain height, in blocks                       |
| A day's contribution level | Block colour, dimmest at the bottom             |
| That week's commit total   | The coin floating above the column              |
| Quiet weeks                | Gaps the runner hops across at ground level     |

The runner advances one week per hop and picks up each coin as it lands, so the
`commits` counter in the HUD climbs to the year's total by the final frame.

## Running it locally

```bash
cd game
npm install
GITHUB_TOKEN=$(gh auth token) node generate.mjs Kiko915 ../game.gif
```

Without a token it falls back to scraping the public calendar fragment at
`github.com/users/<login>/contributions`, which carries levels but not always
exact per-day counts.

Environment variables: `GH_LOGIN`, `OUT_PATH`, `GITHUB_TOKEN`. Set
`DEBUG_FRAME=<n>` to write just that single frame, which is handy when tuning
the layout.

## Files

- `generate.mjs` - layout, animation and GIF encoding
- `contributions.mjs` - calendar fetch (GraphQL, with a scrape fallback)
- `sprites.mjs` - runner, coin and pickup-burst pixel art
- `font.mjs` - 5x7 bitmap font for the HUD and month ruler

Frames are encoded as transparent deltas against the static calendar backdrop,
which is what keeps a 204-frame 873x207 animation under 200 KB.
