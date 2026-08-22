// Reads the last 365 days of the contribution calendar.
// Primary source is the GraphQL API; if no token is available we fall back to
// the public calendar fragment that github.com serves for any profile.

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`;

async function viaGraphQL(login, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'terminal-runner',
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error(`no calendar returned for "${login}"`);
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) => ({
      days: w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? 0,
      })),
    })),
  };
}

async function viaScrape(login) {
  const res = await fetch(`https://github.com/users/${login}/contributions`, {
    headers: { 'User-Agent': 'terminal-runner', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error(`scrape HTTP ${res.status}`);
  const html = await res.text();

  const days = [];
  const cell = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"[^>]*>/g;
  for (const m of html.matchAll(cell)) {
    days.push({ date: m[1], level: Number(m[2]), count: 0 });
  }
  if (!days.length) throw new Error('scrape found no day cells');

  // Counts live in sibling <tool-tip> elements keyed by cell id; when we cannot
  // recover them, approximate from the level so the score still scales sensibly.
  const counts = new Map();
  const tip = /<tool-tip[^>]*for="([^"]+)"[^>]*>\s*(?:No|(\d+))\s+contribution/g;
  for (const m of html.matchAll(tip)) counts.set(m[1], Number(m[2] ?? 0));
  const ids = [...html.matchAll(/<td[^>]*id="(contribution-day-component-[^"]+)"/g)].map((m) => m[1]);
  days.forEach((d, i) => {
    const known = counts.get(ids[i]);
    d.count = known ?? [0, 1, 3, 6, 10][d.level];
  });

  days.sort((a, b) => a.date.localeCompare(b.date));

  // Re-group into calendar columns: a week starts on Sunday.
  const weeks = [];
  let current = null;
  for (const d of days) {
    const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    if (!current || weekday === 0) {
      current = { days: [] };
      weeks.push(current);
    }
    current.days.push(d);
  }
  return { total: days.reduce((s, d) => s + d.count, 0), weeks };
}

export async function fetchCalendar(login, token) {
  if (token) {
    try {
      return await viaGraphQL(login, token);
    } catch (err) {
      console.warn(`GraphQL fetch failed (${err.message}); falling back to public calendar`);
    }
  }
  return viaScrape(login);
}
