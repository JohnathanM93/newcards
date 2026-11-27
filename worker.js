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
      const res = await fetch(upstreamUrl, { headers: { accept: 'application/json' } });
      if (!res.ok) return proxyResponse(res);

      const manifest = await res.json();
      manifest.id = `${manifest.id || 'community.sports.fly'}.custom`;
      manifest.name = `${manifest.name || 'Sports Streams'} (Custom Cards)`;

      return jsonResponse(manifest);
    }

    // 3. Intercept catalog JSON responses to rewrite poster URLs
    const catalogMatch = url.pathname.match(/\/catalog\/([^/]+)\/([^/.]+)(?:\/[^.]+)?\.json$/);
    if (catalogMatch) {
      const catalogId = decodeURIComponent(catalogMatch[2]);
      const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
      const res = await fetch(upstreamUrl, { headers: { accept: 'application/json' } });
      if (!res.ok) return proxyResponse(res);

      const data = await res.json();
      if (Array.isArray(data.metas)) {
        data.metas = data.metas.map((meta) => rewriteMeta(meta, catalogId, url.origin));
      }

      return jsonResponse(data);
    }

    // 4. Pass through /meta, /stream, and everything else directly to Highfly
    const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
    const upstreamRes = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        accept: request.headers.get('accept') || '*/*',
        'user-agent': request.headers.get('user-agent') || 'Nuvio-Proxy-Worker'
      }
    });

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
    /\blive\b/i.test(`${meta.releaseInfo || ''} ${desc}`);

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
      <text x="480" y="218" font-size="34" font-weight="800" fill="#f8fafc" text-anchor="middle" letter-spacing="1">${xml(titleA)}</text>
      <text x="480" y="256" font-size="16" font-weight="800" fill="#f59e0b" text-anchor="middle" letter-spacing="2">VS</text>
      <text x="480" y="298" font-size="34" font-weight="800" fill="#f8fafc" text-anchor="middle" letter-spacing="1">${xml(titleB)}</text>
    `;
  } else {
    // Single-title event (e.g. UFC card, F1 Grand Prix, or Live TV Channel)
    const title = (teamA || league).toUpperCase().slice(0, 34);
    const fontSize = title.length > 24 ? 32 : 40;
    centerSvg = `
      <text x="480" y="268" font-size="${fontSize}" font-weight="800" fill="#f8fafc" text-anchor="middle" letter-spacing="1">${xml(title)}</text>
    `;
  }

  const liveBadge = isLive
    ? `<g transform="translate(836, 30)">
        <rect width="88" height="30" rx="5" fill="#e11d48"/>
        <circle cx="18" cy="15" r="4.5" fill="#ffffff"/>
        <text x="52" y="20" font-size="13" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="1">LIVE</text>
      </g>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.start}"/>
        <stop offset="100%" stop-color="${theme.end}"/>
      </linearGradient>
    </defs>

    <!-- Card Background -->
    <rect width="${width}" height="${height}" rx="20" fill="url(#bg)"/>

    <!-- Subtle right-side decorative ring watermark -->
    <g opacity="0.06" stroke="#ffffff" stroke-width="10" fill="none">
      <circle cx="760" cy="285" r="145"/>
      <circle cx="760" cy="285" r="95"/>
    </g>

    <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif">
      <!-- Top-Left League Label -->
      <circle cx="44" cy="45" r="5" fill="${theme.accent}"/>
      <text x="58" y="50" font-size="15" font-weight="800" fill="${theme.accent}" letter-spacing="1.5">${xml(league)}</text>

      <!-- Top-Right LIVE Pill -->
      ${liveBadge}

      <!-- Center Matchup -->
      ${centerSvg}

      <!-- Bottom-Center Time -->
      ${time ? `<text x="480" y="492" font-size="18" font-weight="700" fill="#e2e8f0" text-anchor="middle" letter-spacing="1">${xml(time.toUpperCase())}</text>` : ''}

      <!-- Bottom-Right Channel -->
      ${channel ? `<text x="920" y="492" font-size="13" font-weight="700" fill="#94a3b8" text-anchor="end" letter-spacing="1">${xml(channel)}</text>` : ''}
    </g>
  </svg>`;

  return new Response(svg, {
    headers: {
      ...CORS_HEADERS,
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'content-security-policy': "default-src 'none'; img-src data:"
    }
  });
}

function renderTeamColumn(teamName, badgeDataUri, cx, cy) {
  const label = teamName.toUpperCase().slice(0, 22);
  const fontSize = label.length > 17 ? 17 : 20;
  const initial = (teamName.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();

  const innerMark = badgeDataUri
    ? `<image href="${badgeDataUri}" x="${cx - 56}" y="${cy - 56}" width="112" height="112" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${cx}" y="${cy + 20}" font-size="56" font-weight="800" fill="#f8fafc" text-anchor="middle">${xml(initial)}</text>`;

  return `
    <circle cx="${cx}" cy="${cy}" r="82" fill="#1e2634" fill-opacity="0.85" stroke="#334155" stroke-width="2"/>
    ${innerMark}
    <text x="${cx}" y="${cy + 125}" font-size="${fontSize}" font-weight="800" fill="#f8fafc" text-anchor="middle" letter-spacing="0.8">${xml(label)}</text>
  `;
}

async function fetchTeamBadgeDataUri(teamName) {
  if (!teamName || teamName.length < 3) return null;
  try {
    const searchUrl = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`;
    const res = await fetch(searchUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return null;

    const json = await res.json();
    const badgeUrl = json?.teams?.[0]?.strBadge;
    if (!badgeUrl) return null;

    const imgRes = await fetch(`${badgeUrl}/tiny`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!imgRes.ok) return null;

    const buf = await imgRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function extractLine(text, regex) {
  const m = text.match(regex);
  return m ? m[1].split('\n')[0].trim() : '';
}

function extractClockTime(text) {
  const m = text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|UTC|GMT|ET|EST|EDT|PT|PST|PDT)?)\b/i);
  return m ? m[1].trim() : '';
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

function proxyResponse(upstreamRes) {
  const headers = new Headers(upstreamRes.headers);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers
  });
}

function xml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
