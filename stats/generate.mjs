// Renders four Daily Bugle styled SVG panels from the GitHub GraphQL API:
// stats.svg (headline figures), langs.svg (language breakdown),
// streak.svg (contribution streaks) and activity.svg (daily chart).
//
// Together these replace every third-party stat card the README used to embed:
// github-readme-stats (shared Vercel deployment, often paused with a 503),
// streak-stats and github-readme-activity-graph. Everything here is committed
// into the repo, so the README never depends on a service that can go down.
//
//   node generate.mjs [login] [outDir]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ theme */

const INK = '#1a1a1a';
const NEWSPRINT = '#ece5d3';
const NEWSPRINT_DK = '#ded5bf';
const BUGLE_RED = '#b3121a';
const MUTED = '#5b5344';

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/* ------------------------------------------------------------------ query */

const QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    login
    name
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) {
      totalCount
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        stargazerCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats(login, token) {
  let after = null;
  let user = null;
  const repos = [];

  for (let page = 0; page < 10; page++) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'daily-bugle-stats',
      },
      body: JSON.stringify({ query: QUERY, variables: { login, after } }),
    });
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));

    user = json.data.user;
    if (!user) throw new Error(`no such user "${login}"`);
    repos.push(...user.repositories.nodes);
    if (!user.repositories.pageInfo.hasNextPage) break;
    after = user.repositories.pageInfo.endCursor;
  }

  const c = user.contributionsCollection;
  const langs = new Map();
  let stars = 0;

  const skip = new Set((process.env.EXCLUDE_REPOS || '')
    .split(',').map((r) => r.trim().toLowerCase()).filter(Boolean));

  for (const repo of repos) {
    stars += repo.stargazerCount;
    if (skip.has(repo.name.toLowerCase())) continue;
    for (const edge of repo.languages.edges) {
      const prev = langs.get(edge.node.name);
      if (prev) prev.size += edge.size;
      else langs.set(edge.node.name, { size: edge.size, color: edge.node.color || '#8b8b8b' });
    }
  }

  const totalBytes = [...langs.values()].reduce((s, l) => s + l.size, 0) || 1;
  const languages = [...langs.entries()]
    .map(([name, l]) => ({ name, share: (l.size / totalBytes) * 100, color: l.color }))
    .sort((a, b) => b.share - a.share);

  const days = c.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date <= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    streaks: computeStreaks(days),
    firstDay: days.length ? days[0].date : null,
    lastDay: days.length ? days[days.length - 1].date : null,
    login: user.login,
    name: user.name || user.login,
    followers: user.followers.totalCount,
    commits: c.totalCommitContributions + c.restrictedContributionsCount,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    contributions: c.contributionCalendar.totalContributions,
    contributedTo: user.repositoriesContributedTo.totalCount,
    repoCount: user.repositories.totalCount,
    stars,
    languages,
  };
}


/* ---------------------------------------------------------------- streaks */

// A streak is a run of consecutive days with at least one contribution. Today
// counts as neutral rather than breaking the run, which is how the streak cards
// people are used to behave - you have not missed the day until it is over.
function computeStreaks(days) {
  let longest = { length: 0, start: null, end: null };
  let run = 0;
  let runStart = null;

  for (const day of days) {
    if (day.contributionCount > 0) {
      if (run === 0) runStart = day.date;
      run++;
      if (run > longest.length) {
        longest = { length: run, start: runStart, end: day.date };
      }
    } else {
      run = 0;
    }
  }

  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today is still open
  let current = 0;
  let end = null;
  let start = null;
  for (; i >= 0 && days[i].contributionCount > 0; i--) {
    if (end === null) end = days[i].date;
    start = days[i].date;
    current++;
  }

  return { current: { length: current, start, end }, longest };
}

/* ------------------------------------------------------------------- util */

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]
));

const num = (n) => n.toLocaleString('en-US');

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'],
  [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

function roman(n) {
  let out = '';
  let left = n;
  for (const [v, s] of ROMAN) {
    while (left >= v) { out += s; left -= v; }
  }
  return out;
}

function paper(w, h) {
  // Newsprint ground plus a faint fibre texture, so it does not read as flat.
  return `  <rect width="${w}" height="${h}" rx="6" fill="${NEWSPRINT}"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="none" stroke="${INK}" stroke-opacity="0.35"/>
  <rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="${INK}" stroke-opacity="0.18"/>`;
}

function rule(x1, x2, y, weight = 1, opacity = 0.75) {
  return `  <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" stroke-opacity="${opacity}" stroke-width="${weight}"/>`;
}

function masthead(w, title, strapline) {
  const pad = 18;
  return [
    rule(pad, w - pad, 26, 2.5),
    rule(pad, w - pad, 30, 1),
    `  <text x="${w / 2}" y="54" text-anchor="middle" font-family="${SERIF}" font-size="26" font-weight="bold" letter-spacing="1.5" fill="${INK}">${esc(title)}</text>`,
    rule(pad, w - pad, 64, 1),
    rule(pad, w - pad, 68, 2.5),
    `  <text x="${w / 2}" y="82" text-anchor="middle" font-family="${SANS}" font-size="8.5" letter-spacing="1.6" fill="${MUTED}">${esc(strapline)}</text>`,
    rule(pad, w - pad, 90, 1, 0.45),
  ].join('\n');
}

/* ------------------------------------------------------------ stats panel */

function renderStats(s) {
  const W = 480;
  const H = 235;
  const pad = 18;
  const today = new Date();
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][today.getUTCMonth()];

  const strap = `VOL. ${roman(today.getUTCFullYear())}  ·  NEW YORK CITY  ·  ${month} ${today.getUTCDate()}  ·  LATE EDITION`;

  const headline = `"MENACE" LOGS ${num(s.contributions)} CONTRIBUTIONS`;

  const rows = [
    [['COMMITS', num(s.commits)], ['STARS', num(s.stars)]],
    [['PULL REQUESTS', num(s.prs)], ['REVIEWS', num(s.reviews)]],
    [['ISSUES', num(s.issues)], ['REPOSITORIES', num(s.repoCount)]],
    [['CONTRIBUTED TO', num(s.contributedTo)], ['FOLLOWERS', num(s.followers)]],
  ];

  const colX = [pad + 8, W / 2 + 6];
  const colValX = [W / 2 - 14, W - pad - 8];

  const body = rows.map(([left, right], i) => {
    const y = 148 + i * 18;
    const cells = [left, right].map(([label, value], c) => (
      `  <text x="${colX[c]}" y="${y}" font-family="${SANS}" font-size="9" letter-spacing="0.9" fill="${MUTED}">${esc(label)}</text>\n` +
      `  <text x="${colValX[c]}" y="${y}" text-anchor="end" font-family="${SERIF}" font-size="13" font-weight="bold" fill="${INK}">${esc(value)}</text>`
    ));
    return cells.join('\n');
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily Bugle GitHub stats for ${esc(s.login)}">
${paper(W, H)}
${masthead(W, 'THE DAILY BUGLE', strap)}
  <text x="${W / 2}" y="112" text-anchor="middle" font-family="${SERIF}" font-size="17" font-weight="bold" fill="${BUGLE_RED}">${esc(headline)}</text>
  <text x="${W / 2}" y="126" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="1.1" fill="${MUTED}">EXCLUSIVE · BY OUR OWN CORRESPONDENT</text>
${rule(pad, W - pad, 133, 1, 0.45)}
${body}
  <line x1="${W / 2 - 4}" y1="138" x2="${W / 2 - 4}" y2="${148 + 3 * 18 + 6}" stroke="${INK}" stroke-opacity="0.25"/>
${rule(pad, W - pad, 216, 1, 0.45)}
  <text x="${pad + 8}" y="${H - 12}" font-family="${SANS}" font-size="8" letter-spacing="1" fill="${MUTED}">PHOTOS BY P. PARKER</text>
  <text x="${W - pad - 8}" y="${H - 12}" text-anchor="end" font-family="${SANS}" font-size="8" letter-spacing="1" fill="${MUTED}">@${esc(s.login.toUpperCase())}</text>
  <rect x="0" y="0" width="${W}" height="${H}" rx="6" fill="${NEWSPRINT_DK}" fill-opacity="0.0"/>
</svg>
`;
}

/* --------------------------------------------------------- language panel */

function renderLangs(s) {
  const W = 400;
  const H = 235;
  const pad = 18;
  const top = s.languages.slice(0, 6);

  const barX = 128;
  const barW = W - pad - 8 - 46 - barX;

  const body = top.map((lang, i) => {
    const y = 128 + i * 16;
    const w = Math.max(3, (lang.share / 100) * barW);
    return [
      `  <text x="${pad + 8}" y="${y}" font-family="${SANS}" font-size="9" letter-spacing="0.9" fill="${INK}">${esc(lang.name.toUpperCase())}</text>`,
      `  <rect x="${barX}" y="${y - 8}" width="${barW}" height="9" fill="${INK}" fill-opacity="0.08"/>`,
      `  <rect x="${barX}" y="${y - 8}" width="${w.toFixed(1)}" height="9" fill="${esc(lang.color)}"/>`,
      `  <rect x="${barX}" y="${y - 8}" width="${w.toFixed(1)}" height="9" fill="none" stroke="${INK}" stroke-opacity="0.45"/>`,
      `  <text x="${W - pad - 8}" y="${y}" text-anchor="end" font-family="${SERIF}" font-size="11" font-weight="bold" fill="${INK}">${lang.share.toFixed(1)}%</text>`,
    ].join('\n');
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily Bugle language breakdown for ${esc(s.login)}">
${paper(W, H)}
${masthead(W, 'THE PRESS ROOM', 'COMPOSING DESK  ·  TYPE SET THIS YEAR')}
  <text x="${W / 2}" y="108" text-anchor="middle" font-family="${SERIF}" font-size="12" font-weight="bold" fill="${BUGLE_RED}">MOST-SET TYPE ACROSS ${num(s.repoCount)} REPOSITORIES</text>
${rule(pad, W - pad, 116, 1, 0.45)}
${body}
${rule(pad, W - pad, 216, 1, 0.45)}
  <text x="${pad + 8}" y="${H - 12}" font-family="${SANS}" font-size="8" letter-spacing="1" fill="${MUTED}">SET IN THE COMPOSING ROOM</text>
  <text x="${W - pad - 8}" y="${H - 12}" text-anchor="end" font-family="${SANS}" font-size="8" letter-spacing="1" fill="${MUTED}">@${esc(s.login.toUpperCase())}</text>
</svg>
`;
}


/* ----------------------------------------------------------- streak panel */

function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${m} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

function renderStreak(s) {
  const W = 880;
  const H = 220;
  const pad = 18;
  const { current, longest } = s.streaks;

  const columns = [
    {
      value: num(s.contributions),
      label: 'TOTAL CONTRIBUTIONS',
      range: `${shortDate(s.firstDay)}  —  ${shortDate(s.lastDay)}`,
    },
    {
      value: num(current.length),
      label: 'DAY CURRENT RUN',
      range: current.length
        ? `${shortDate(current.start)}  —  ${shortDate(current.end)}`
        : 'PRESSES IDLE',
      feature: true,
    },
    {
      value: num(longest.length),
      label: 'DAY LONGEST RUN',
      range: longest.length
        ? `${shortDate(longest.start)}  —  ${shortDate(longest.end)}`
        : '—',
    },
  ];

  const body = columns.map((col, i) => {
    const cx = (W / 3) * i + W / 6;
    const parts = [];
    if (col.feature) {
      parts.push(`  <circle cx="${cx}" cy="154" r="27" fill="none" stroke="${BUGLE_RED}" stroke-opacity="0.55" stroke-width="1.5"/>`);
      parts.push(`  <circle cx="${cx}" cy="154" r="31" fill="none" stroke="${BUGLE_RED}" stroke-opacity="0.25"/>`);
    }
    parts.push(`  <text x="${cx}" y="163" text-anchor="middle" font-family="${SERIF}" font-size="30" font-weight="bold" fill="${col.feature ? BUGLE_RED : INK}">${esc(col.value)}</text>`);
    parts.push(`  <text x="${cx}" y="192" text-anchor="middle" font-family="${SANS}" font-size="9" letter-spacing="1.1" fill="${INK}">${esc(col.label)}</text>`);
    parts.push(`  <text x="${cx}" y="204" text-anchor="middle" font-family="${SANS}" font-size="7.5" letter-spacing="0.7" fill="${MUTED}">${esc(col.range)}</text>`);
    return parts.join('\n');
  }).join('\n');

  const dividers = [1, 2].map((i) => (
    `  <line x1="${(W / 3) * i}" y1="124" x2="${(W / 3) * i}" y2="208" stroke="${INK}" stroke-opacity="0.25"/>`
  )).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily Bugle contribution streak for ${esc(s.login)}">
${paper(W, H)}
${masthead(W, 'THE PRESS RUN', 'CIRCULATION DESK  ·  CONSECUTIVE DAYS ON THE BEAT')}
  <text x="${W / 2}" y="110" text-anchor="middle" font-family="${SERIF}" font-size="12" font-weight="bold" fill="${BUGLE_RED}">${esc(current.length ? 'THE PRESSES HAVE NOT STOPPED' : 'PRESSES IDLE — RUN BROKEN')}</text>
${rule(pad, W - pad, 118, 1, 0.45)}
${dividers}
${body}
</svg>
`;
}

/* --------------------------------------------------------- activity panel */

// Trailing n-day mean. Returns null for the leading days that have no full
// window yet, so the average line starts where it is actually meaningful.
function movingAverage(values, window) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

function renderActivity(s) {
  const W = 880;
  const H = 290;
  const pad = 18;

  const days = s.days;
  const values = days.map((d) => d.contributionCount);
  const n = values.length;

  const x0 = 52;
  const x1 = W - 26;
  const chartW = x1 - x0;
  const top = 130;
  const bottom = 225;
  const chartH = bottom - top;

  const peak = Math.max(1, ...values);
  // Round the axis up to something a reader can hold in their head.
  const step = peak <= 10 ? 2 : peak <= 25 ? 5 : peak <= 60 ? 10 : 20;
  const axisMax = Math.ceil(peak / step) * step;

  const xAt = (i) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
  const yAt = (v) => bottom - (v / axisMax) * chartH;

  const peakIndex = values.indexOf(peak);
  const active = values.filter((v) => v > 0).length;
  const average = values.reduce((a, b) => a + b, 0) / (n || 1);

  const busiest = new Map();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    busiest.set(key, (busiest.get(key) || 0) + d.contributionCount);
  }
  const ranked = [...busiest.entries()].sort((a, b) => b[1] - a[1]);
  const bestMonth = ranked.length ? ranked[0][0] : null;

  // Filled area under the daily series.
  const area = [`M ${x0.toFixed(1)},${bottom}`]
    .concat(values.map((v, i) => `L ${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`))
    .concat([`L ${x1.toFixed(1)},${bottom}`, 'Z'])
    .join(' ');

  const avgSeries = movingAverage(values, 7);
  let avgPath = '';
  let started = false;
  for (let i = 0; i < n; i++) {
    if (avgSeries[i] === null) continue;
    avgPath += `${started ? ' L' : 'M'} ${xAt(i).toFixed(1)},${yAt(avgSeries[i]).toFixed(1)}`;
    started = true;
  }

  // Horizontal gridlines with value labels.
  const grid = [];
  for (let v = 0; v <= axisMax; v += step) {
    const y = yAt(v);
    grid.push(`  <line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" stroke="${INK}" stroke-opacity="${v === 0 ? 0.5 : 0.13}"/>`);
    grid.push(`  <text x="${x0 - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="${SANS}" font-size="7.5" fill="${MUTED}">${v}</text>`);
  }

  // Month ticks on the first of each month.
  const ticks = [];
  for (let i = 0; i < n; i++) {
    if (!days[i].date.endsWith('-01')) continue;
    const d = new Date(days[i].date + 'T00:00:00Z');
    const label = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
    const x = xAt(i);
    ticks.push(`  <line x1="${x.toFixed(1)}" y1="${bottom}" x2="${x.toFixed(1)}" y2="${bottom + 4}" stroke="${INK}" stroke-opacity="0.4"/>`);
    ticks.push(`  <text x="${x.toFixed(1)}" y="${bottom + 15}" text-anchor="middle" font-family="${SANS}" font-size="7.5" letter-spacing="0.6" fill="${MUTED}">${label}</text>`);
  }

  const peakX = xAt(peakIndex);
  const peakY = yAt(peak);
  const labelAnchor = peakX > W - 150 ? 'end' : 'start';
  const labelDx = labelAnchor === 'end' ? -8 : 8;

  const ticker = [
    ['SESSION HIGH', num(peak)],
    ['DAILY AVERAGE', average.toFixed(1)],
    ['ACTIVE SESSIONS', `${num(active)} / ${num(n)}`],
    ['BUSIEST MONTH', bestMonth ? `${MONTH_ABBR[Number(bestMonth.slice(5, 7)) - 1]} ${bestMonth.slice(0, 4)}` : '—'],
  ].map(([label, value], i) => {
    const cx = (W / 4) * i + W / 8;
    return `  <text x="${cx}" y="261" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="1" fill="${MUTED}">${esc(label)}</text>\n` +
      `  <text x="${cx}" y="275" text-anchor="middle" font-family="${SERIF}" font-size="13" font-weight="bold" fill="${INK}">${esc(value)}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily Bugle daily contribution chart for ${esc(s.login)}">
${paper(W, H)}
${masthead(W, 'THE COMMIT EXCHANGE', 'MARKET DESK  ·  DAILY TRADING IN COMMITS  ·  52 WEEKS')}
  <text x="${W / 2}" y="110" text-anchor="middle" font-family="${SERIF}" font-size="12" font-weight="bold" fill="${BUGLE_RED}">HIGH OF ${num(peak)} IN A SINGLE SESSION  ·  ${num(active)} SESSIONS TRADED</text>
${rule(pad, W - pad, 118, 1, 0.45)}
${grid.join('\n')}
  <path d="${area}" fill="${INK}" fill-opacity="0.2"/>
  <path d="${avgPath}" fill="none" stroke="${BUGLE_RED}" stroke-opacity="0.85" stroke-width="1.6" stroke-linejoin="round"/>
${ticks.join('\n')}
  <circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="3" fill="none" stroke="${BUGLE_RED}" stroke-width="1.4"/>
  <text x="${(peakX + labelDx).toFixed(1)}" y="${(peakY + 3).toFixed(1)}" text-anchor="${labelAnchor}" font-family="${SANS}" font-size="7.5" letter-spacing="0.6" fill="${BUGLE_RED}">HIGH ${num(peak)} · ${esc(shortDate(days[peakIndex].date))}</text>
  <text x="${x1}" y="126" text-anchor="end" font-family="${SANS}" font-size="7" letter-spacing="0.6" fill="${MUTED}">RED LINE: 7-DAY MOVING AVERAGE</text>
${rule(pad, W - pad, 248, 1, 0.45)}
${ticker}
</svg>
`;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const login = process.env.GH_LOGIN || process.argv[2] || 'Kiko915';
  const outDir = process.env.OUT_DIR || process.argv[3] || '.';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!token) throw new Error('GITHUB_TOKEN is required for the stats panels');

  const stats = await fetchStats(login, token);
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'stats.svg'), renderStats(stats));
  writeFileSync(join(outDir, 'langs.svg'), renderLangs(stats));
  writeFileSync(join(outDir, 'streak.svg'), renderStreak(stats));
  writeFileSync(join(outDir, 'activity.svg'), renderActivity(stats));

  console.log(`${login}: ${num(stats.contributions)} contributions, ${num(stats.stars)} stars, ` +
    `${stats.repoCount} repos, top language ${stats.languages[0]?.name ?? 'n/a'}`);
  console.log(`streak: ${stats.streaks.current.length} current, ${stats.streaks.longest.length} longest`);
  console.log(`wrote stats.svg, langs.svg, streak.svg and activity.svg to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
