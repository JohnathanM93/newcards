const UPSTREAM_ORIGIN = 'https://sports.highfly.to';

// Map Highfly catalog IDs to display labels when meta doesn't include a league
const CATALOG_LABELS = {
  sports_live: 'LIVE SPORTS',
  sports_channels: 'LIVE CHANNELS',
  sports_today: 'TODAY',
  sports_football: 'FOOTBALL',
  sports_basketball: 'BASKETBALL',
  league_nba: 'NBA',
  sports_american_football: 'AMERICAN FOOTBALL',
  league_nfl: 'NFL',
  'league_college-fb': 'COLLEGE FOOTBALL',
  sports_hockey: 'HOCKEY',
  league_nhl: 'NHL',
  sports_baseball: 'BASEBALL',
  league_mlb: 'MLB',
  sports_motor_sports: 'MOTOR SPORTS',
  sports_fight: 'FIGHT NIGHT',
  sports_tennis: 'TENNIS'
};

// League/sport color palettes matching the screenshot style
const THEMES = [
  {
    match: /premier league|football|soccer|champions|la liga|serie a|bundesliga/i,
    start: '#12352c',
    end: '#161b22',
    accent: '#4ade80'
  },
  {
    match: /\bnhl\b|hockey/i,
    start: '#152c38',
    end: '#161a22',
    accent: '#38bdf8'
  },
  {
    match: /ncaa|college/i,
    start: '#3b1c4a',
    end: '#181c2b',
    accent: '#c084fc'
  },
  {
    match: /\bnba\b|basketball/i,
    start: '#3b2016',
    end: '#181a22',
    accent: '#fb923c'
  },
  {
    match: /\bnfl\b|american football/i,
    start: '#172942',
    end: '#151821',
    accent: '#60a5fa'
  },
  {
    match: /\bmlb\b|baseball/i,
    start: '#1b2845',
    end: '#171923',
    accent: '#93c5fd'
  },
  {
    match: /ufc|fight|boxing|mma/i,
    start: '#3f151b',
    end: '#17181f',
    accent: '#f87171'
  },
  {
    match: /motor|f1|formula/i,
    start: '#381818',
    end: '#181920',
    accent: '#f87171'
  }
];

const DEFAULT_THEME = {
  start: '#1c2536',
  end: '#14171f',
  accent: '#94a3b8'
};

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*'
};

async function fetchUpstream(upstreamUrl, accept = 'application/json', method = 'GET') {
  return fetch(upstreamUrl, {
    method,
    headers: {
      accept,
      'accept-language': 'en-US,en;q=0.9',
      origin: 'https://sports.highfly.to',
      referer: 'https://sports.highfly.to/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. Custom SVG poster endpoint
    if (url.pathname === '/poster.svg') {
      return renderPoster(url.searchParams);
    }

    // 2. Intercept manifest.json (supports optional config prefix like /<config>/manifest.json)
    if (url.pathname.endsWith('/manifest.json')) {
      const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
      const res = await fetchUpstream(upstreamUrl, 'application/json');
      if (!res.ok) return proxyResponse(res);

      const manifest = await res.json();
      manifest.id = `${manifest.id \vert{}\vert{} 'community.sports.fly'}.custom`; manifest.name = `${manifest.name || 'Sports Streams'} (Custom Cards)`;

      return jsonResponse(manifest);
    }

    // 3. Intercept catalog JSON responses to rewrite poster URLs
    const catalogMatch = url.pathname.match(/\/catalog\/([^/]+)\/([^/.]+)(?:\/[^.]+)?\.json$/);
    if (catalogMatch) {
      const catalogId = decodeURIComponent(catalogMatch[2]);
      const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`; const res = await fetchUpstream(upstreamUrl, 'application/json'); if (!res.ok) return proxyResponse(res);  const data = await res.json(); if (Array.isArray(data.metas)) { data.metas = data.metas.map((meta) => rewriteMeta(meta, catalogId, url.origin)); }  return jsonResponse(data); }  // 4. Pass through /meta, /stream, and everything else directly to Highfly const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
    const upstreamRes = await fetchUpstream(
      upstreamUrl,
      request.headers.get('accept') || '*/*',
      request.method
    );

    return proxyResponse(upstreamRes);
  }
};

function rewriteMeta(meta, catalogId, workerOrigin) {
  const rawName = (meta.name || '').trim();
  const desc = (meta.description || '').trim();

  // Extract league/competition
  const league =
    (Array.isArray(meta.genres) && meta.genres[0]) ||
    extractLine(desc, /(?:league|competition|tournament)\s*:\s*(.+)/i) ||
    CATALOG_LABELS[catalogId] ||
    'SPORTS';

  // Extract start time and channel/broadcaster if present in description or releaseInfo
  const time =
    extractLine(desc, /(?:time|start|kickoff|starts)\s*:\s*(.+)/i) ||
    (meta.releaseInfo && !/live/i.test(meta.releaseInfo) ? String(meta.releaseInfo) : '') ||
    extractClockTime(desc) ||
    '';

  const channel =
    extractLine(desc, /(?:channel|tv|broadcaster|network|stream)\s*:\s*(.+)/i) || '';

  const isLive =
    catalogId === 'sports_live' ||
    /\blive\b/i.test(`${meta.releaseInfo \vert{}\vert{} ''}${desc}`);

  // Split "Team A vs Team B" or "Team A @ Team B"
  const vsMatch = rawName.match(/^(.+?)\s+(?:vs\.?|v\.?|@)\s+(.+)$/i);
  const teamA = vsMatch ? vsMatch[1].trim() : rawName;
  const teamB = vsMatch ? vsMatch[2].trim() : '';

  const params = new URLSearchParams({
    league,
    teamA,
    teamB,
    time,
    channel,
    live: isLive ? '1' : '0'
  });

  // Preserve original poster URL as a fallback/badge source if needed
  if (meta.poster) {
    params.set('orig', meta.poster);
  }

  return {
    ...meta,
    poster: `${workerOrigin}/poster.svg?${params.toString()}`,
    posterShape: 'landscape'
  };
}

async function renderPoster(params) {
  const width = 960;
  const height = 540;

  const league = (params.get('league') || 'SPORTS').toUpperCase().slice(0, 36);
  const teamA = (params.get('teamA') || '').trim();
  const teamB = (params.get('teamB') || '').trim();
  const time = (params.get('time') || '').trim().slice(0, 24);
  const channel = (params.get('channel') || '').toUpperCase().trim().slice(0, 26);
  const isLive = params.get('live') === '1';

  const theme = THEMES.find((t) => t.match.test(league)) || DEFAULT_THEME;

  // Try fetching team badges from TheSportsDB free search endpoint (cached by Cloudflare edge)
  const [badgeA, badgeB] = teamB
    ? await Promise.all([fetchTeamBadgeDataUri(teamA), fetchTeamBadgeDataUri(teamB)])
    : [null, null];

  const hasTwoTeams = Boolean(teamA && teamB);
  const hasAnyBadge = Boolean(badgeA || badgeB);

  let centerSvg = '';

  if (hasTwoTeams && hasAnyBadge) {
    // Two-column circular medallion layout (matches cards 1-7 in your screenshot)
    centerSvg = `
      ${renderTeamColumn(teamA, badgeA, 255, 235)}
      <circle cx="480" cy="235" r="24" fill="#181e29" stroke="#334155" stroke-width="1.5"/>
      <text x="480" y="241" font-size="14" font-weight="800" fill="#94a3b8" text-anchor="middle" letter-spacing="1">VS</text>
      ${renderTeamColumn(teamB, badgeB, 705, 235)}
    `;
  } else if (hasTwoTeams) {
    // Stacked text fallback when neither team has a badge (matches card 8 in your screenshot)
    const titleA = teamA.toUpperCase().slice(0, 28);
    const titleB = teamB.toUpperCase().slice(0, 28);
    centerSvg = `
      <text x="480" y="218" font-size="34" font-weight="800" fill="#f8fafc" text
