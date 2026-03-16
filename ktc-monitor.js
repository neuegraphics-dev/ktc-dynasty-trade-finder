const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk').default;
const TeamName = 'Montreal Moonshiners';
require('dotenv').config();

// ============================================
// AI ANALYST PROMPT
// Edit this to change what the AI analyzes.
// It will always run with current league data as context.
// ============================================
const ANALYST_PROMPT = `You are a dynasty fantasy football analyst. 

Step 1: Create a short report on the strengths and weakensses of team {TeamName}, along with ideas for imporving the team's weakensses. 2-4 setencences.

Step 2: Based on the league roster data provided, create a team stregth weakness report for each team 1 setence each. Identify players {TeamName} should target on each team. Identify if there are any win win trade ideas for each team.

Step 3: Based on the league roster data provided, identify the top 3 trade targets I ({TeamName}) should pursue to improve my team. For each target, name the player, which team has them, why I should want them, and what I might offer in return. Be concise and direct. 


Step 4: Ensure all player trades are formatted in an HTML table for easy reading in an email HTML reader as this prompt will be em.`;

// ============================================
// CONFIGURATION
// ============================================
// KTC Dynasty Rankings configuration
const KTC_CONFIG = {
  name: "KTC Dynasty Rankings",
  url: 'https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE|RDP&format=1',
  selectors: {
    parentContainer: '#rankings-page-rankings',
    playerCard: '.onePlayer',
    name: '.player-name p a',
    value: '.single-ranking .value p'
  }
};

// Roster URL — timestamp param ensures fresh data each fetch
const ROSTER_URL = () =>
  `https://keeptradecut.com/dynasty/power-rankings/team-breakdown?leagueId=1319880534624591872&platform=2&team=180481036336381952&t=${Date.now()}`;

// ============================================
// CONFIGURATION
// ============================================
// Subtract this from QB values to normalize for 1QB league
const QB_1QB_ADJUSTMENT = -2250;

function adjustedValue(player) {
  return player.position === 'QB'
    ? Math.max(0, player.value + QB_1QB_ADJUSTMENT)
    : player.value;
}

// ============================================
// DATABASE SETUP
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'playerValues.json');
const ROSTERS_FILE = path.join(DATA_DIR, 'leagueRosters.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Initialize database if it doesn't exist
 * Creates a fresh playerValues.json with empty structure
 */
function initDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      lastUpdated: null,
      players: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * Get database contents
 * Returns the current playerValues data from playerValues.json
 */
function getDatabase() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    console.error('Error reading database:', error.message);
    return { lastUpdated: null, players: [] };
  }
}

/**
 * Save database contents
 * Writes the updated playerValues data back to playerValues.json
 * This completely REPLACES the file content - no appending
 */
function saveDatabase(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ============================================
// player PARSING FUNCTIONS
// ============================================

/**
 * Create unique player ID from name only
 * Value is excluded so the same player is tracked across value changes
 */
function getplayerId(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

/**
 * Parse individual player card from HTML
 * Extracts player name, value, and link from a single .onePlayer element
 */
function parseplayer($, playerElement) {
  try {
    const $el = $(playerElement);

    const $nameLink = $el.find(KTC_CONFIG.selectors.name).first();
    const name = $nameLink.text().trim();
    const linkHref = $nameLink.attr('href');
    const link = linkHref ? (linkHref.startsWith('http') ? linkHref : 'https://keeptradecut.com' + linkHref) : null;
    const valueText = $el.find(KTC_CONFIG.selectors.value).first().text().trim();
    const value = parseInt(valueText, 10) || 0;

    return {
      id: getplayerId(name),
      name,
      link,
      value
    };
  } catch (error) {
    console.error('Error parsing player:', error.message);
    return null;
  }
}


/**
 * Fetch and parse the KTC league page once.
 * Returns { leagueTeams, playersMap } for use by roster functions.
 */
async function fetchLeaguePageData() {
  const rosterUrl = ROSTER_URL();
  const response = await axios.get(rosterUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  const html = response.data;
  const leagueTeamsMatch = html.match(/var leagueTeams = (\[.*?\]);/s);
  const playersArrayMatch = html.match(/var playersArray = (\[.*?\]);/s);

  if (!leagueTeamsMatch || !playersArrayMatch) {
    throw new Error('Could not find inline player data in page HTML');
  }

  const leagueTeams = JSON.parse(leagueTeamsMatch[1]);
  const playersArray = JSON.parse(playersArrayMatch[1]);
  const playersMap = new Map(playersArray.map(p => [p.playerID, p]));

  return { leagueTeams, playersMap };
}

/**
 * Build a roster array from a team entry and the shared playersMap.
 */
function buildRoster(team, playersMap) {
  const players = [];
  team.playerIds.forEach(pid => {
    const p = playersMap.get(pid);
    if (!p) return;
    const value = p.superflexValues?.value ?? 0;
    const link = `https://keeptradecut.com/dynasty-rankings/players/${p.slug}`;
    players.push({ id: getplayerId(p.playerName), name: p.playerName, position: p.position, value, link });
  });
  return players;
}

/**
 * Fetch my roster from the KTC team breakdown page.
 */
async function fetchMyRoster(leagueData) {
  try {
    console.log('\n👤 Fetching my roster...');
    const { leagueTeams, playersMap } = leagueData;

    const teamIdMatch = ROSTER_URL().match(/[?&]team=(\d+)/);
    const teamId = teamIdMatch ? teamIdMatch[1] : null;
    const myTeam = leagueTeams.find(t => t.teamId === teamId);

    if (!myTeam) {
      console.warn(`⚠️ Team ${teamId} not found in leagueTeams`);
      return [];
    }

    const players = buildRoster(myTeam, playersMap);
    console.log(`✅ Fetched ${players.length} roster players`);
    return players;

  } catch (error) {
    console.error('❌ Error fetching roster:', error.message);
    return [];
  }
}

/**
 * Build all 12 teams' rosters and save to leagueRosters.json.
 */
async function fetchAllTeams(leagueData) {
  try {
    console.log('\n🏈 Building all team rosters...');
    const { leagueTeams, playersMap } = leagueData;

    const teams = leagueTeams.map(team => {
      const players = buildRoster(team, playersMap)
        .map(p => ({ ...p, adjustedValue: adjustedValue(p) }))
        .sort((a, b) => b.adjustedValue - a.adjustedValue);

      const totalValue = players.reduce((sum, p) => sum + p.adjustedValue, 0);

      return {
        teamId: team.teamId,
        name: team.name,
        totalValue,
        players
      };
    });

    teams.sort((a, b) => b.totalValue - a.totalValue);

    const data = { lastUpdated: new Date().toISOString(), teams };
    fs.writeFileSync(ROSTERS_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Saved ${teams.length} teams to leagueRosters.json`);
    return teams;

  } catch (error) {
    console.error('❌ Error building team rosters:', error.message);
    return [];
  }
}

// ============================================
// PAGE FETCHING FUNCTIONS
// ============================================

/**
 * Fetch a single page of KTC dynasty rankings
 * Makes HTTP request to specified page number
 * Returns array of player objects found on that page
 */
async function fetchPage(pageNum) {
  try {
    const url = `https://keeptradecut.com/dynasty-rankings?page=${pageNum}&filters=QB|WR|RB|TE|RDP&format=1`;
    
    console.log(`Fetching page ${pageNum}...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    const players = [];
    const $container = $(KTC_CONFIG.selectors.parentContainer);

    if ($container.length === 0) {
      console.warn(`⚠️ Parent container not found on page ${pageNum}`);
      // Return a snippet of the HTML to help diagnose what was actually returned
      const snippet = $.html().slice(0, 2000);
      return { players: [], containerFound: false, snippet };
    }
    
    $container.find(KTC_CONFIG.selectors.playerCard).each((idx, playerEl) => {
      const player = parseplayer($, playerEl);
      if (player && player.name) {
        players.push(player);
      }
    });
    
    console.log(`✅ Found ${players.length} players on page ${pageNum}`);
    return { players, containerFound: true };

  } catch (error) {
    console.error(`❌ Error fetching page ${pageNum}:`, error.message);
    return { players: [], containerFound: false, snippet: error.message };
  }
}

/**
 * Fetch all pages of KTC dynasty rankings.
 * KTC has no total-results indicator in its HTML, so we keep paginating
 * (starting at page=0) until a page returns 0 players or all duplicates.
 * MAX_PAGES is a hard safety cap against infinite loops.
 */
async function fetchAllPages() {
  try {
    console.log(`\n📊 Fetching all pages for ${KTC_CONFIG.name}...`);

    const MAX_PAGES = 20;
    let allplayers = [];
    let seenplayerIds = new Set();
    let pagesFetched = 0;

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const pageData = await fetchPage(pageNum);
      const pageplayers = pageData.players;
      pagesFetched++;

      if (!pageData.containerFound) {
        console.warn(`⚠️ Rankings container not found on page ${pageNum}`);
        return { players: [], containerFound: false, snippet: pageData.snippet };
      }

      if (pageplayers.length === 0) {
        console.log(`⚠️ Page ${pageNum} returned 0 players — stopping`);
        break;
      }

      let newCount = 0;
      let dupCount = 0;

      pageplayers.forEach(player => {
        if (!seenplayerIds.has(player.id)) {
          allplayers.push(player);
          seenplayerIds.add(player.id);
          newCount++;
        } else {
          dupCount++;
        }
      });

      console.log(`   📦 Page ${pageNum}: ${newCount} new, ${dupCount} duplicates`);

      // All duplicates means we've looped back to a page we've already seen
      if (dupCount === pageplayers.length) {
        console.warn(`⚠️ Page ${pageNum} was all duplicates — stopping`);
        break;
      }
    }

    console.log(`\n✅ Fetching complete: ${allplayers.length} unique players across ${pagesFetched} pages`);
    return { players: allplayers, containerFound: true };

  } catch (error) {
    console.error(`❌ Error fetching pages:`, error.message);
    return { players: [], containerFound: false, snippet: error.message };
  }
}

// ============================================
// CHANGE DETECTION FUNCTIONS
// ============================================

const VALUE_CHANGE_THRESHOLD = 500;

/**
 * Detect changes between old and new player values
 * - added: players new to the rankings
 * - valueChanges: players whose value moved by ±500 or more
 * Removed players are not reported but are automatically dropped
 * from playerValues.json since the DB is fully replaced each run.
 */
function detectChanges(oldplayers, newplayers) {
  const changes = {
    added: [],
    valueChanges: []
  };

  // If no old data exists, everything is "new" — skip email noise
  if (!oldplayers || oldplayers.length === 0) {
    return changes;
  }

  const oldMap = new Map(oldplayers.map(p => [p.id, p]));

  // Find added players (in new but not in old)
  newplayers.forEach(player => {
    if (!oldMap.has(player.id)) {
      changes.added.push(player);
    }
  });

  // Find value changes >= ±750
  newplayers.forEach(newplayer => {
    const oldplayer = oldMap.get(newplayer.id);
    if (oldplayer) {
      const diff = newplayer.value - oldplayer.value;
      if (Math.abs(diff) >= VALUE_CHANGE_THRESHOLD) {
        changes.valueChanges.push({
          name: newplayer.name,
          oldValue: oldplayer.value,
          newValue: newplayer.value,
          diff,
          link: newplayer.link
        });
      }
    }
  });

  // Sort value changes: biggest movers first
  changes.valueChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return changes;
}

// ============================================
// AI ANALYSIS FUNCTION
// ============================================

/**
 * Send league roster data + ANALYST_PROMPT to Claude and return the response text.
 * Returns null if ANTHROPIC_API_KEY is not set or the call fails.
 */
async function fetchAIAnalysis(myTeam, allTeams) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY not set, skipping AI analysis');
    return null;
  }

  try {
    console.log('\n🤖 Running AI analysis...');
    const client = new Anthropic();

    // Build a compact league summary to pass as context
    const leagueSummary = allTeams.map(team => {
      const players = team.players.map(p => `${p.position} ${p.name} (${p.adjustedValue.toLocaleString()})`).join(', ');
      const marker = team.name === myTeam.name ? ' ← MY TEAM' : '';
      return `${team.name}${marker} [Total: ${team.totalValue.toLocaleString()}]\n  ${players}`;
    }).join('\n\n');

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Here are all 12 teams in my dynasty fantasy football league with their rosters and KTC 1QB values:\n\n${leagueSummary}\n\n${ANALYST_PROMPT.replace(/\{TeamName\}/g, myTeam.name)}`
      }]
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    console.log('✅ AI analysis complete');
    return text;

  } catch (error) {
    console.error('❌ AI analysis failed:', error.message);
    return null;
  }
}

// ============================================
// EMAIL FUNCTIONS
// ============================================

/**
 * Build HTML email content.
 * Always starts with the full roster section, then league-wide value changes and new players.
 */
function buildEmailHTML(changes, rosterPlayers, previousPlayersMap, aiAnalysis) {
  let html = `
    <h2 style="color: #0066cc;">📊 ${KTC_CONFIG.name}</h2>
    <p style="font-size: 14px; color: #666;">Update checked at ${new Date().toLocaleString()}</p>
  `;

  // ── MY ROSTER (always shown) ──────────────────────────────────────
  html += `<h3 style="color: #0066cc; margin-top: 24px;">🏈 My Roster</h3>`;

  if (rosterPlayers.length === 0) {
    html += `<p style="color:#999; font-size:13px;">Could not fetch roster this run.</p>`;
  } else {
    // Group by position
    const byPosition = {};
    rosterPlayers.forEach(p => {
      if (!byPosition[p.position]) byPosition[p.position] = [];
      byPosition[p.position].push(p);
    });

    Object.entries(byPosition).forEach(([position, players]) => {
      html += `<p style="margin: 16px 0 6px; font-size: 12px; font-weight: bold; color: #999; text-transform: uppercase; letter-spacing: 1px;">${position}</p>`;

      players.forEach(player => {
        const displayValue = adjustedValue(player);
        const prev = previousPlayersMap.get(player.id);
        let changeHtml = '';

        if (!prev) {
          changeHtml = `<span style="color:#888; font-size:12px;"> — NEW</span>`;
        } else {
          const diff = player.value - prev.value;
          if (diff === 0) {
            changeHtml = `<span style="color:#888; font-size:12px;"> — unchanged</span>`;
          } else {
            const isUp = diff > 0;
            const color = isUp ? '#27ae60' : '#e74c3c';
            const arrow = isUp ? '▲' : '▼';
            changeHtml = `<span style="color:${color}; font-size:12px; font-weight:bold;"> ${arrow} ${Math.abs(diff).toLocaleString()}</span>`;
          }
        }

        html += `
          <div style="margin: 6px 0; padding: 10px 12px; border-left: 4px solid #0066cc; background:#efefef; border-radius: 0px 8px 8px 8px;">
            <span style="font-weight:bold;">
              <a href="${player.link || '#'}" style="color:#0066cc; text-decoration:none;">${player.name}</a>
            </span>
            <span style="color:#555; font-size:13px; margin-left:8px;">${displayValue.toLocaleString()}${changeHtml}</span>
          </div>
        `;
      });
    });
  }

  // ── LEAGUE-WIDE VALUE CHANGES ─────────────────────────────────────
  if (changes.valueChanges.length > 0) {
    html += `<h3 style="color: #f39c12; margin-top: 28px;">💰 Value Changes ±${VALUE_CHANGE_THRESHOLD.toLocaleString()}+ (${changes.valueChanges.length})</h3>`;
    changes.valueChanges.forEach(change => {
      const isUp = change.diff > 0;
      const arrow = isUp ? '▲' : '▼';
      const color = isUp ? '#27ae60' : '#e74c3c';
      html += `
        <div style="margin: 6px 0; padding: 10px 12px; border-left: 4px solid ${color}; border-radius: 0px 8px 8px 8px; background:#efefef;">
          <span style="font-weight:bold;">
            <a href="${change.link || '#'}" style="color:#0066cc; text-decoration:none;">${change.name}</a>
          </span>
          <span style="font-size:13px; margin-left:8px;">
            ${change.oldValue.toLocaleString()} → <strong style="color:${color};">${change.newValue.toLocaleString()}</strong>
            <span style="color:${color}; font-weight:bold;"> ${arrow} ${Math.abs(change.diff).toLocaleString()}</span>
          </span>
        </div>
      `;
    });
  }

  // ── NEW PLAYERS IN RANKINGS ───────────────────────────────────────
  if (changes.added.length > 0) {
    html += `<h3 style="color: #27ae60; margin-top: 28px;">✨ New Players in Rankings (${changes.added.length})</h3>`;
    changes.added.forEach(player => {
      html += `
        <div style="margin: 6px 0; padding: 10px 12px; border-left: 4px solid #27ae60; border-radius: 0px 8px 8px 8px; background:#efefef;">
          <span style="font-weight:bold;">
            <a href="${player.link || '#'}" style="color:#0066cc; text-decoration:none;">${player.name}</a>
          </span>
          <span style="color:#555; font-size:13px; margin-left:8px;">${player.value.toLocaleString()}</span>
        </div>
      `;
    });
  }

  // ── AI ANALYSIS ───────────────────────────────────────────────────
  if (aiAnalysis) {
    html += `
      <h3 style="color: #6c3483; margin-top: 28px;">🤖 AI Trade Analysis</h3>
      <div style="padding: 12px 16px; background: #f5eef8; border-left: 4px solid #6c3483; border-radius: 0px 8px 8px 8px; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${aiAnalysis}</div>
    `;
  }

  return html;
}

/**
 * Send email via Gmail (nodemailer)
 */
async function sendEmail(htmlContent) {
  const toEmail = process.env.GMAIL_TO_EMAIL;

  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS || !toEmail) {
    console.warn('⚠️ Gmail credentials not configured, skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: [toEmail],
      subject: `KTC - playerValues Update`,
      html: htmlContent
    });
    console.log('✅ Email sent successfully');
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
  }
}

// ============================================
// MAIN MONITORING FUNCTION
// ============================================

/**
 * Main monitoring function - orchestrates the entire process
 *
 * FLOW:
 * 1. Initialize database (create if doesn't exist)
 * 2. Load previous playerValues from database
 * 3. Fetch current playerValues from website (with safety mechanisms)
 * 4. Detect changes (added players / value changes ±750+)
 * 5. Send email if changes detected
 * 6. REPLACE database with current playerValues (not append!)
 */
async function monitor() {
  console.log('📊 Starting KTC Dynasty Rankings monitoring...');
  console.log('============================================================');

  // Step 1: Initialize and load database
  initDatabase();
  const db = getDatabase();
  const previousplayers = db.players || [];
  console.log(`📚 Loaded ${previousplayers.length} players from previous run`);
  const previousPlayersMap = new Map(previousplayers.map(p => [p.id, p]));

  // Step 2: Fetch league page data once, then rankings in parallel
  let leagueData;
  try {
    leagueData = await fetchLeaguePageData();
  } catch (err) {
    console.error('❌ Failed to fetch league page data:', err.message);
    leagueData = { leagueTeams: [], playersMap: new Map() };
  }

  const [rankingsResult, rosterPlayers] = await Promise.all([
    fetchAllPages(),
    fetchMyRoster(leagueData)
  ]);

  // If the rankings container wasn't found, send a diagnostic email and abort
  if (!rankingsResult.containerFound) {
    console.error('❌ Rankings container not found — sending diagnostic email');
    const diagnosticHTML = `
      <h2 style="color:#e74c3c;">⚠️ KTC Rankings Scrape Failed</h2>
      <p style="font-size:14px; color:#666;">Run attempted at ${new Date().toLocaleString()}</p>
      <p style="font-size:14px; color:#333;">
        The selector <code>#rankings-page-rankings</code> was not found in the KTC page response.
        The selectors may need updating or KTC may be blocking the request.
      </p>
      <h3 style="color:#333;">HTML Snippet (first 2000 chars)</h3>
      <pre style="background:#f5f5f5; padding:12px; font-size:11px; overflow:auto; white-space:pre-wrap;">${rankingsResult.snippet || 'No snippet available'}</pre>
    `;
    await sendEmail(diagnosticHTML);
    return;
  }

  const currentplayers = rankingsResult.players;

  if (currentplayers.length === 0) {
    console.error('❌ No players fetched, aborting to avoid data loss');
    return;
  }

  // Step 3: Detect league-wide changes
  console.log('\n🔍 Detecting changes...');
  const changes = detectChanges(previousplayers, currentplayers);

  console.log(`   👤 Roster players: ${rosterPlayers.length}`);
  console.log(`   ✨ New in rankings: ${changes.added.length}`);
  console.log(`   💰 Value changes (±${VALUE_CHANGE_THRESHOLD}+): ${changes.valueChanges.length}`);

  // Step 4: Run AI analysis + send email
  const allTeams = await fetchAllTeams(leagueData);
  const myTeam = allTeams.find(t => t.name === TeamName) ?? allTeams[0];
  const aiAnalysis = await fetchAIAnalysis(myTeam, allTeams);
  const htmlContent = buildEmailHTML(changes, rosterPlayers, previousPlayersMap, aiAnalysis);
  await sendEmail(htmlContent);

  // Step 5: Save updated playerValues
  console.log(`💾 Saving ${currentplayers.length} players to database...`);
  db.players = currentplayers;
  db.lastUpdated = new Date().toISOString();
  saveDatabase(db);

  console.log('============================================================');
  console.log('✅ Monitor run completed successfully');
}

// ============================================
// RUN THE MONITOR
// ============================================
monitor().catch(console.error);
