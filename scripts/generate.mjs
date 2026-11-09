#!/usr/bin/env node
// Generates the profile SVGs (hero, season heatmap, neofetch card) from the GitHub GraphQL API.
// Zero dependencies — Node 20+. Usage: GITHUB_TOKEN=... node scripts/generate.mjs [outDir]

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOGIN = process.env.PROFILE_LOGIN || "D3vaya";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || "dist";

const PROFILE = {
  name: "Juan Carlos Ayala",
  alias: "d3vaya",
  role: "Head of Engineering",
  company: "Porteria®",
  location: "Santiago, Chile",
  codingSince: 2014,
  shell: "TypeScript · Elixir",
  hobbies: "football · manga · game dev",
  motto: "Intentando ser un buen programador",
};

const C = {
  bg: "#0b0f17",
  panel: "#0f1520",
  line: "#1e2635",
  text: "#e6edf3",
  muted: "#8b98a9",
  cyan: "#22d3ee",
  violet: "#a78bfa",
  red: "#ef4444",
  blue: "#2563eb",
  levels: ["#161d29", "#0e4f5c", "#0891b2", "#7c3aed", "#c4b5fd"],
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("en-US");

async function gql(query, variables) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-svg-generator" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function fetchData() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        followers { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) {
          totalCount
          nodes { languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
        }
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalPullRequestContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date weekday contributionCount contributionLevel } }
          }
        }
      }
    }`,
    { login: LOGIN, from: `${year}-01-01T00:00:00Z`, to: now.toISOString() },
  );
  return { year, now, user: data.user };
}

// ─────────────────────────────── stats ───────────────────────────────

function seasonStats(weeks, now) {
  const today = now.toISOString().slice(0, 10);
  const days = weeks.flatMap((w) => w.contributionDays).filter((d) => d.date <= today);
  let longest = 0, run = 0, best = { date: null, contributionCount: 0 };
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (d.contributionCount > best.contributionCount) best = d;
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today not over yet
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  const active = days.filter((d) => d.contributionCount > 0).length;
  return { longest, current, best, active, total: days.length };
}

function topLanguages(repos, n = 5) {
  const map = new Map();
  for (const r of repos) for (const e of r.languages.edges) {
    const cur = map.get(e.node.name) || { name: e.node.name, color: e.node.color || C.muted, size: 0 };
    cur.size += e.size;
    map.set(e.node.name, cur);
  }
  const list = [...map.values()].sort((a, b) => b.size - a.size);
  const sum = list.reduce((s, l) => s + l.size, 0) || 1;
  return list.slice(0, n).map((l) => ({ ...l, pct: (l.size / sum) * 100 }));
}

// ─────────────────────────────── shared bits ───────────────────────────────

// Chilean pennant (a nod to github.com/D3vaya/pennants), gently waving.
function chilePennant(x, y, scale = 1) {
  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <rect x="-4" y="-10" width="6" height="190" rx="3" fill="#94a3b8"/>
    <circle cx="-1" cy="-12" r="7" fill="#e2e8f0"/>
    <g class="wave">
      <clipPath id="pen"><path d="M2 0 L182 60 L2 120 Z"/></clipPath>
      <g clip-path="url(#pen)">
        <rect x="2" y="0" width="190" height="60" fill="#f8fafc"/>
        <rect x="2" y="60" width="190" height="60" fill="${C.red}"/>
        <rect x="2" y="0" width="60" height="60" fill="${C.blue}"/>
        <path transform="translate(32 30) scale(1.25)" fill="#fff"
          d="M0,-14 L3.3,-4.5 L13.3,-4.3 L5.3,1.7 L8.2,11.3 L0,5.6 L-8.2,11.3 L-5.3,1.7 L-13.3,-4.3 L-3.3,-4.5 Z"/>
      </g>
      <path d="M2 0 L182 60 L2 120 Z" fill="none" stroke="#00000033" stroke-width="2"/>
    </g>
  </g>`;
}

const gridPattern = (id) => `
  <pattern id="${id}" width="24" height="24" patternUnits="userSpaceOnUse">
    <path d="M24 0H0V24" fill="none" stroke="${C.line}" stroke-width="1" opacity="0.55"/>
  </pattern>`;

// ─────────────────────────────── hero ───────────────────────────────

function hero({ year, user, stats }) {
  const W = 1000, H = 300;
  const cal = user.contributionsCollection.contributionCalendar;
  const years = year - PROFILE.codingSince;
  const chips = [
    [`${years}+ yrs`, "shipping software"],
    [fmt(cal.totalContributions), `contributions in ${year}`],
    [`${stats.active}`, `active days in ${year}`],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(PROFILE.name)} — ${esc(PROFILE.role)} at ${esc(PROFILE.company)}">
  <defs>
    ${gridPattern("grid")}
    <radialGradient id="glowA" cx="0.15" cy="0.1" r="0.7"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowB" cx="0.9" cy="0.9" r="0.6"><stop offset="0" stop-color="${C.violet}" stop-opacity="0.25"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
    <linearGradient id="name" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="${C.cyan}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  </defs>
  <style>
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
    .mono { font-family: ${MONO}; }
    .sans { font-family: ${SANS}; }
    .rise { animation: rise .8s cubic-bezier(.2,.7,.2,1) both; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .cursor { animation: blink 1.1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .wave { transform-origin: 2px 60px; animation: wave 3.2s ease-in-out infinite; }
    @keyframes wave { 0%,100% { transform: skewY(0deg) scaleX(1); } 50% { transform: skewY(-3deg) scaleX(.96); } }
    .scan { animation: scan 6s linear infinite; }
    @keyframes scan { from { transform: translateY(-40px); } to { transform: translateY(${H + 40}px); } }
  </style>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#glowA)"/>
    <rect width="${W}" height="${H}" fill="url(#glowB)"/>
    <rect class="scan" width="${W}" height="40" fill="${C.cyan}" opacity="0.04"/>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.line}"/>

  <g class="rise" style="animation-delay:.05s">
    <text x="48" y="62" class="mono" font-size="15" fill="${C.cyan}">~/${esc(PROFILE.alias)} <tspan fill="${C.muted}">$ whoami</tspan></text>
  </g>
  <g class="rise" style="animation-delay:.25s">
    <text x="46" y="122" class="sans" font-size="54" font-weight="800" letter-spacing="-1.5" fill="url(#name)">${esc(PROFILE.name)}</text>
  </g>
  <g class="rise" style="animation-delay:.45s">
    <text x="48" y="162" class="mono" font-size="20" fill="${C.text}">${esc(PROFILE.role)} <tspan fill="${C.muted}">@</tspan> <tspan fill="${C.violet}" font-weight="700">${esc(PROFILE.company)}</tspan><tspan class="cursor" fill="${C.cyan}"> ▍</tspan></text>
  </g>
  <g class="rise" style="animation-delay:.6s">
    <text x="48" y="192" class="mono" font-size="14" fill="${C.muted}">${esc(PROFILE.location)} · since ${PROFILE.codingSince} · ${esc(PROFILE.shell)}</text>
  </g>

  ${chips
    .map(
      ([big, small], i) => `
  <g class="rise" style="animation-delay:${0.8 + i * 0.15}s" transform="translate(${48 + i * 200} 218)">
    <rect width="184" height="54" rx="10" fill="${C.panel}" stroke="${C.line}"/>
    <text x="14" y="25" class="mono" font-size="18" font-weight="700" fill="${i === 1 ? C.cyan : C.text}">${esc(big)}</text>
    <text x="14" y="43" class="mono" font-size="11" fill="${C.muted}">${esc(small)}</text>
  </g>`,
    )
    .join("")}

  ${chilePennant(770, 58, 0.95)}
</svg>`;
}

// ─────────────────────────────── season heatmap ───────────────────────────────

function season({ year, now, user, stats }) {
  const cc = user.contributionsCollection;
  const weeks = cc.contributionCalendar.weeks;
  const today = now.toISOString().slice(0, 10);
  const CELL = 14, GAP = 4, STEP = CELL + GAP;
  const left = 56, top = 140;
  const gridW = 53 * STEP;
  const W = left + gridW + 40, H = 330 + 26;
  const lvl = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

  const DAY = 86400000;
  const jan1 = Date.UTC(year, 0, 1);
  const origin = jan1 - new Date(jan1).getUTCDay() * DAY; // Sunday on/before Jan 1
  const counts = new Map(weeks.flatMap((w) => w.contributionDays).map((d) => [d.date, d]));
  const months = [];
  let cells = "";
  for (let t = jan1; t <= Date.UTC(year, 11, 31); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const wd = new Date(t).getUTCDay();
    const wi = Math.floor((t - origin) / DAY / 7);
    const x = left + wi * STEP, y = top + wd * STEP;
    if (date.endsWith("-01")) months.push([wd === 0 ? wi : wi + 1, Number(date.slice(5, 7)) - 1]);
    const d = counts.get(date);
    if (date > today || !d) {
      cells += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="3" fill="none" stroke="${C.line}" stroke-dasharray="2 2"/>`;
      continue;
    }
    const fill = C.levels[lvl[d.contributionLevel] ?? 0];
    cells += `<rect class="c" style="animation-delay:${(wi * 0.018).toFixed(3)}s" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${fill}"><title>${date}: ${d.contributionCount} contributions</title></rect>`;
  }
  months[0][0] = 0;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabels = months
    .map(([wi, m]) => `<text x="${left + wi * STEP}" y="${top - 12}" class="mono" font-size="12" fill="${C.muted}">${MONTHS[m]}</text>`)
    .join("");
  const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]]
    .map(([d, l]) => `<text x="${left - 12}" y="${top + d * STEP + 11}" text-anchor="end" class="mono" font-size="11" fill="${C.muted}">${l}</text>`)
    .join("");

  const bestLabel = stats.best.date
    ? new Date(`${stats.best.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "—";
  const board = [
    ["CONTRIBUTIONS", fmt(cc.contributionCalendar.totalContributions), C.cyan],
    ["ACTIVE DAYS", `${stats.active}/${stats.total}`, C.text],
    ["LONGEST STREAK", `${stats.longest}d`, C.violet],
    ["CURRENT STREAK", `${stats.current}d`, C.text],
    ["BEST DAY", `${stats.best.contributionCount} · ${bestLabel}`, C.text],
  ];
  const colW = (W - 96) / board.length;

  const legend = C.levels
    .map((c, i) => `<rect x="${W - 40 - (5 - i) * 18}" y="${H - 34}" width="14" height="14" rx="3" fill="${c}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${year} contribution heatmap: ${cc.contributionCalendar.totalContributions} contributions">
  <defs>${gridPattern("g2")}</defs>
  <style>
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
    .mono { font-family: ${MONO}; }
    .c { animation: pop .45s ease-out both; }
    @keyframes pop { from { opacity: 0; } to { opacity: 1; } }
    .live { animation: live 1.4s ease-in-out infinite; }
    @keyframes live { 50% { opacity: .25; } }
  </style>
  <rect width="${W}" height="${H}" rx="18" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="18" fill="url(#g2)" opacity=".5"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.line}"/>

  <text x="48" y="44" class="mono" font-size="13" fill="${C.muted}">SEASON <tspan fill="${C.text}" font-weight="700">${year}</tspan> · git log --since=${year}-01-01 --author=${esc(PROFILE.alias)}</text>
  <circle class="live" cx="${W - 92}" cy="40" r="5" fill="${C.red}"/>
  <text x="${W - 80}" y="44" class="mono" font-size="12" font-weight="700" fill="${C.red}">LIVE</text>

  ${board
    .map(
      ([k, v, color], i) => `
  <g transform="translate(${48 + i * colW} 62)">
    <text class="mono" font-size="10" letter-spacing="1.5" fill="${C.muted}">${k}</text>
    <text y="22" class="mono" font-size="17" font-weight="700" fill="${color}">${esc(v)}</text>
  </g>`,
    )
    .join("")}

  ${monthLabels}
  ${dayLabels}
  ${cells}

  <text x="48" y="${H - 22}" class="mono" font-size="11" fill="${C.muted}">${fmt(cc.totalCommitContributions + cc.restrictedContributionsCount)} commits &amp; private work · ${fmt(cc.totalPullRequestContributions)} PRs · updated ${today}</text>
  <text x="${W - 40 - 5 * 18 - 8}" y="${H - 23}" text-anchor="end" class="mono" font-size="11" fill="${C.muted}">less</text>
  ${legend}
  <text x="${W - 36}" y="${H - 23}" class="mono" font-size="11" fill="${C.muted}">more</text>
</svg>`;
}

// ─────────────────────────────── neofetch card ───────────────────────────────

function neofetch({ year, user }) {
  const W = 1000;
  const langs = topLanguages(user.repositories.nodes);
  const cal = user.contributionsCollection.contributionCalendar;
  const rows = [
    ["user", `${PROFILE.alias}@github`],
    ["role", `${PROFILE.role} @ ${PROFILE.company}`],
    ["creator", "carcassonne-latam.com"],
    ["host", PROFILE.location],
    ["uptime", `${year - PROFILE.codingSince} years writing code (since ${PROFILE.codingSince})`],
    ["shell", PROFILE.shell],
    ["repos", `${user.repositories.totalCount} owned · ${user.followers.totalCount} followers`],
    ["commits", `${fmt(cal.totalContributions)} contributions in ${year}`],
    ["hobbies", PROFILE.hobbies],
    ["motto", PROFILE.motto],
  ];
  const LH = 26, top = 92;
  const H = top + rows.length * LH + 92;

  // pixel-art "D3" logo (box-drawing chars render inconsistently across fonts)
  const glyphs = {
    D: ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."],
    3: ["XXXX.", "....X", "....X", ".XXX.", "....X", "....X", "XXXX."],
  };
  const PX = 26, PG = 4;
  let logo = "", n = 0;
  ["D", "3"].forEach((ch, gi) => glyphs[ch].forEach((row, ry) => [...row].forEach((c, rx) => {
    if (c !== "X") return;
    logo += `<rect class="px" style="animation-delay:${(0.15 + n++ * 0.03).toFixed(2)}s" x="${60 + gi * 6 * (PX + PG) + rx * (PX + PG)}" y="${top + ry * (PX + PG)}" width="${PX}" height="${PX}" rx="4" fill="url(#logo)"/>`;
  })));

  const barX = 520, barW = 420;
  let acc = 0;
  const bar = langs
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const r = `<rect x="${barX + acc}" y="${H - 66}" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
      acc += w;
      return r;
    })
    .join("");
  const legend = langs
    .map((l, i) => `<g transform="translate(${barX + (i % 3) * 140} ${H - 38 + Math.floor(i / 3) * 18})"><circle r="5" cy="-4" cx="5" fill="${l.color}"/><text x="16" class="mono" font-size="12" fill="${C.text}">${esc(l.name)} <tspan fill="${C.muted}">${l.pct.toFixed(1)}%</tspan></text></g>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="neofetch-style profile summary">
  <defs><linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient><clipPath id="bar"><rect x="${barX}" y="${H - 66}" width="${barW}" height="10" rx="5"/></clipPath></defs>
  <style>
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
    .mono { font-family: ${MONO}; }
    .ln { animation: type .01s both; }
    @keyframes type { from { opacity: 0; } to { opacity: 1; } }
    .grow { transform-origin: ${barX}px 0; animation: grow 1.2s 1.6s cubic-bezier(.2,.7,.2,1) both; }
    @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    .px { animation: type .01s both; }
    .cursor { animation: blink 1.1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
  </style>
  <rect width="${W}" height="${H}" rx="14" fill="${C.panel}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${C.line}"/>
  <path d="M0 14 a14 14 0 0 1 14 -14 H${W - 14} a14 14 0 0 1 14 14 V40 H0 Z" fill="#141b28"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="25" text-anchor="middle" class="mono" font-size="12" fill="${C.muted}">${esc(PROFILE.alias)} — zsh — 120×40</text>

  <text x="40" y="72" class="mono" font-size="14" fill="${C.cyan}">❯ <tspan fill="${C.text}">neofetch</tspan></text>

  ${logo}

  <text x="520" y="${top + 4}" class="mono" font-size="15" font-weight="700" fill="${C.cyan}">${esc(PROFILE.alias)}<tspan fill="${C.muted}">@</tspan><tspan fill="${C.violet}">github</tspan></text>
  <rect x="520" y="${top + 12}" width="150" height="1" fill="${C.line}"/>
  ${rows
    .slice(1)
    .map(
      ([k, v], i) => `<text class="ln mono" style="animation-delay:${0.7 + i * 0.12}s" x="520" y="${top + 38 + i * LH}" font-size="14"><tspan fill="${C.violet}" font-weight="700">${k}</tspan><tspan x="610" fill="${C.text}">${esc(v)}</tspan></text>`,
    )
    .join("")}

  <text x="40" y="${H - 56}" class="mono" font-size="12" fill="${C.muted}">top languages across ${user.repositories.totalCount} repos →</text>
  ${C.levels.concat([C.cyan, C.violet, C.red]).map((c, i) => `<rect x="${40 + i * 30}" y="${H - 40}" width="26" height="14" fill="${c}"/>`).join("")}
  <g clip-path="url(#bar)"><rect x="${barX}" y="${H - 66}" width="${barW}" height="10" fill="${C.line}"/><g class="grow">${bar}</g></g>
  ${legend}
  <text x="${40 + 8 * 30 + 6}" y="${H - 28}" class="mono cursor" font-size="16" fill="${C.cyan}">▍</text>
</svg>`;
}

// ─────────────────────────────── main ───────────────────────────────

const ctx = await fetchData();
ctx.stats = seasonStats(ctx.user.contributionsCollection.contributionCalendar.weeks, ctx.now);
await mkdir(OUT, { recursive: true });
await Promise.all([
  writeFile(join(OUT, "hero.svg"), hero(ctx)),
  writeFile(join(OUT, "season.svg"), season(ctx)),
  writeFile(join(OUT, "neofetch.svg"), neofetch(ctx)),
]);
console.log(`✔ ${OUT}/hero.svg, season.svg, neofetch.svg — ${ctx.user.contributionsCollection.contributionCalendar.totalContributions} contributions in ${ctx.year}`);
