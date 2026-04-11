const axios = require('axios');
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
const ANALYST_PROMPT = `You are a sharp, opinionated dynasty fantasy football analyst who writes like an insider — direct, specific, and unafraid to take positions. Generate a concise HTML email newsletter for {{TEAM_NAME}} in a 12-team .5PPR 1QB dynasty league (6pt passing TD, start 1QB/2RB/3WR/1TE/1FLEX, 13 bench).

<team_context>
{{TEAM_NAME}} STRATEGIC PROFILE:
- Window: Win-now contender targeting a 2025–2026 championship window
- Philosophy: Stay competitive while quietly rebuilding aging assets before the cliff
- Age cliff thresholds: RB = 28+, WR/TE = 31+
- Roster needs: Respectable RB3, overall depth over top-heavy concentration
- Willing to: Move TEs to upgrade the roster, acquire cheaper aging vets for depth
- Unwilling to: Trade away young valuable assets without receiving a clear upgrade
- Style: Loves bold moves and calculated gambles that could hit big
</team_context>

Here is the team you are analyzing:
<team_name>
{{TEAM_NAME}}
</team_name>

Here is the league roster data for all teams:
<league_roster_data>
{{LEAGUE_ROSTER_DATA}}
</league_roster_data>

Here is the player values data from Keep Trade Cut (1QB format — use these for all trade valuations):
<player_values>
{{PLAYER_VALUES}}
</player_values>

---

**SECTION 1: All Team Assessments**
For EVERY team in the league (including {{TEAM_NAME}}), output a compact block using this exact format:

<h5>[Team Name]</h5>
<strong>Strengths:</strong> QB, RB, WR, TE, or "position" depth (no player names)<br/>
<strong>Weaknesses:</strong> QB, RB, WR, TE, or "position" depth (no player names)<br/>
<strong>Age Cliff Risk:</strong> [flag any key starters at or past cliff: RB 28+, WR/TE 31+. Write "None" if clean.]<br/>
<strong>Competing or Rebuilding:</strong> [Contender / Fringe / Rebuilder]<br/>
<strong>Improvement:</strong> 1 sentence<br/>
<strong>Win-Win with {{TEAM_NAME}}:</strong> [Only include if a realistic trade exists. Format: Give [player(s)] (KTC value) · Get [player(s)] (KTC value). Skip this line entirely if no trade applies.]<br/>
<hr/>

Do this for all teams before moving to Section 2.

---

**SECTION 2: Players to Target**
List the top 8–10 players {{TEAM_NAME}} should pursue to improve the team — from any team or free agency. For each player include:
- Name, current team, age, KTC value
- One sentence on why {{TEAM_NAME}} should want them (specific to roster fit)
- Tag each as: 🟢 Buy Low | 🔵 Fair Value | 🟡 Sell High (if on {{TEAM_NAME}}'s roster)

Include at least:
- 2 buy-low targets (underperforming or aging players on rebuilding teams who can be had cheap)
- 1 free agent / waiver target if applicable
- 1 sell-high candidate FROM {{TEAM_NAME}}'s own roster whose KTC value exceeds projected output

---

**SECTION 3: Win-Win Trades**
Build 5 trade proposals. Present each as a two-column HTML table:

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; margin-bottom:8px;">
<tr><th style="background:#f0f0f0;">{{TEAM_NAME}} Gives</th><th style="background:#f0f0f0;">[Other Team] Gives</th></tr>
<tr><td>Player Name (KTC value)</td><td>Player Name (KTC value)</td></tr>
<tr><td><strong>Total: X</strong></td><td><strong>Total: X</strong></td></tr>
</table>
<strong>Why it works for {{TEAM_NAME}}:</strong> [1 sentence]<br/>
<strong>Why it works for [Other Team]:</strong> [1 sentence]<br/>
<strong>Value gap:</strong> [percentage difference]<br/>
<strong>Feasibility:</strong> 🟢 Likely | 🟡 Possible | 🔴 Long Shot<br/>
<hr/>

**TRADE CONSTRUCTION RULES:**
- Use KTC values from the provided data as the PRIMARY basis. Do not guess or invent values.
- Trades must address a real positional need for BOTH sides.
- Value differential should stay within 15% for realistic deals. Flag anything beyond that.
- In 2-for-1 trades, the team receiving the single asset must get the largest piece — consolidation premium applies.
- At least 1 trade must involve draft pick capital.
- At least 1 trade must be a 3-player+ package or multi-team concept.
- Consider age cliff arbitrage: buying a 27-year-old RB cheaply from a rebuilder scared of the cliff.
- Consider sell-high windows: if {{TEAM_NAME}} has a player whose KTC value exceeds projected 2025 output, use them as a trade chip.
- Consider "sweetener" picks — adding a late 3rd to grease a deal that's close but not quite there.

**INSIDER TRADE INTEL:**
Use this as SECONDARY context to validate feasibility or flag deals that won't happen. Generate trade ideas from roster needs + KTC values FIRST, then cross-reference against these notes. Do NOT just repackage these notes as trade ideas.

Trade Block (confirmed available):
Justin Herbert, Tyler Allgeier, Dalton Schultz, Chubba Hubbard, Cortland Sutton, Gunnar Helm, Cade Otton, 2.05, Aaron Jones, Joe Mixon, Caleb Williams, Devonta Smith, Breece Hall.

Manager Tendencies:
| Manager | Willing to Move | Wants | Style / Notes |
|---------|----------------|-------|---------------|
| Shockers | AD Mitchell + '27 2nd | '26 2nd | Rebuilding. Won't move McConkey. Had interest in Flowers last year. |
| Moosejaw | J. Sanders (TE depth) | 3.03 | Only takes clear value wins in his favor. Hates mid/late picks, only values 1st rounders. |
| Coolers | Godwin | 2.05, wants to move up in draft | Interested in S. LaPorta — explore 3-way trade with Bruce. Interested in AJ Brown if traded to Patriots. Won't trade Maye. |
| Bruce | Hurts (for FLEX upgrade) | FLEX-caliber player | Slight interest in Kincaid. |
| Top Cheddar | Vidal | Tracy, another draft pick cheap, wants to move up in draft | Looking to consolidate. |

---

**SECTION 4: Bold Moves**
Suggest 2 aggressive or unconventional moves that could reshape {{TEAM_NAME}}. These can be:
- Overpays that make strategic sense for the championship window
- Multi-team blockbuster concepts (3-way trades)
- Contrarian "the league will roast you but you might win the ship" moves
- Selling a perceived core piece at peak value to reload depth

For each, use the same trade table format, then:
<strong>The case for it:</strong> [2–3 sentences — why this is worth the risk]<br/>
<strong>The risk:</strong> [1 sentence — what could go wrong]<br/>
<hr/>

---

**FORMATTING RULES:**
- HTML email compatible — no CSS classes, no divs, just semantic tags (h3, h5, strong, br, hr, table)
- Bold tags for team names and section headers
- Keep everything concise — no long paragraphs, no filler
- Do not add an introduction, greeting, or conclusion — start directly with Section 1
- Trades should not be based on info the AI thinks it knows — use the provided KTC player values and roster data only

**Keep response within 8,000 tokens.**`;


// ============================================
// CONFIGURATION
// ============================================

// KTC rankings (format=1) — matches oneQBValues from the KTC roster page.
// Used for value change detection, AI analysis, team reports, and trending arrows.
const KTC_CONFIG = {
  name: "KTC Dynasty Rankings",
  url: 'https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE|RDP&format=1'
};

// Roster URL — timestamp param ensures fresh data each fetch
// Used for each team's player roster. Player values pulled as 1QB (oneQBValues field).
const ROSTER_URL = () =>
  `https://keeptradecut.com/dynasty/power-rankings/team-breakdown?leagueId=1319880534624591872&platform=2&team=180481036336381952&t=${Date.now()}`;

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
function getPlayerId(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
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
    const value = p.oneQBValues?.value ?? 0;
    const link = `https://keeptradecut.com/dynasty-rankings/players/${p.slug}`;
    players.push({ id: getPlayerId(p.playerName), name: p.playerName, position: p.position, value, link });
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
        .sort((a, b) => b.value - a.value);

      const totalValue = players.reduce((sum, p) => sum + p.value, 0);

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
async function fetchPage(pageNum, format = 1) {
  try {
    const url = `https://keeptradecut.com/dynasty-rankings?page=${pageNum}&filters=QB|WR|RB|TE|RDP&format=${format}`;

    console.log(`Fetching page ${pageNum}...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;

    // KTC now embeds all player data as an inline JS variable — extract it directly
    const playersArrayMatch = html.match(/var playersArray = (\[.*?\]);/s);
    if (!playersArrayMatch) {
      console.warn(`⚠️ playersArray variable not found on page ${pageNum}`);
      return { players: [], containerFound: false, snippet: html.slice(0, 2000) };
    }

    const playersArray = JSON.parse(playersArrayMatch[1]);
    const players = playersArray
      .map(p => {
        const valObj = format === 2 ? p.superflexValues : p.oneQBValues;
        const value = valObj?.value ?? 0;
        return {
          id: getPlayerId(p.playerName),
          name: p.playerName,
          link: p.slug ? `https://keeptradecut.com/dynasty-rankings/players/${p.slug}` : null,
          value
        };
      })
      .filter(p => p.name);

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
async function fetchAllPages(format = 1) {
  try {
    console.log(`\n📊 Fetching all pages for ${KTC_CONFIG.name}...`);

    const MAX_PAGES = 20;
    let allPlayers = [];
    let seenPlayerIds = new Set();
    let pagesFetched = 0;

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const pageData = await fetchPage(pageNum, format);
      const pagePlayers = pageData.players;
      pagesFetched++;

      if (!pageData.containerFound) {
        console.warn(`⚠️ Rankings container not found on page ${pageNum}`);
        return { players: [], containerFound: false, snippet: pageData.snippet };
      }

      if (pagePlayers.length === 0) {
        console.log(`⚠️ Page ${pageNum} returned 0 players — stopping`);
        break;
      }

      let newCount = 0;
      let dupCount = 0;

      pagePlayers.forEach(player => {
        if (!seenPlayerIds.has(player.id)) {
          allPlayers.push(player);
          seenPlayerIds.add(player.id);
          newCount++;
        } else {
          dupCount++;
        }
      });

      console.log(`   📦 Page ${pageNum}: ${newCount} new, ${dupCount} duplicates`);

      // All duplicates means we've looped back to a page we've already seen
      if (dupCount === pagePlayers.length) {
        console.warn(`⚠️ Page ${pageNum} was all duplicates — stopping`);
        break;
      }
    }

    console.log(`\n✅ Fetching complete: ${allPlayers.length} unique players across ${pagesFetched} pages`);
    return { players: allPlayers, containerFound: true };

  } catch (error) {
    console.error(`❌ Error fetching pages:`, error.message);
    return { players: [], containerFound: false, snippet: error.message };
  }
}

// ============================================
// CHANGE DETECTION FUNCTIONS
// ============================================

const VALUE_CHANGE_THRESHOLD = 250;

/**
 * Detect changes between old and new player values
 * - added: players new to the rankings
 * - valueChanges: players whose value moved by ±/-250 or more
 * Removed players are not reported but are automatically dropped
 * from playerValues.json since the DB is fully replaced each run.
 */
function detectChanges(oldPlayers, newPlayers) {
  const changes = {
    added: [],
    valueChanges: []
  };

  // If no old data exists, everything is "new" — skip email noise
  if (!oldPlayers || oldPlayers.length === 0) {
    return changes;
  }

  const oldMap = new Map(oldPlayers.map(p => [p.id, p]));

  // Find added players (in new but not in old)
  newPlayers.forEach(player => {
    if (!oldMap.has(player.id)) {
      changes.added.push(player);
    }
  });

  // Find value changes if player value goes up or down by greater than 250
  newPlayers.forEach(newPlayer => {
    const oldPlayer = oldMap.get(newPlayer.id);
    if (oldPlayer) {
      const diff = newPlayer.value - oldPlayer.value;
      if (Math.abs(diff) > VALUE_CHANGE_THRESHOLD) {
        changes.valueChanges.push({
          name: newPlayer.name,
          oldValue: oldPlayer.value,
          newValue: newPlayer.value,
          diff,
          link: newPlayer.link
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
async function fetchAIAnalysis(myTeam, allTeams, players) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY not set, skipping AI analysis');
    return null;
  }

  try {
    console.log('\n🤖 Running AI analysis...');
    const client = new Anthropic();

    // Build league roster data — all 12 teams with every player and their adjusted value
    const leagueRosterData = allTeams.map(team => {
      const marker = team.name === myTeam.name ? ' ← MY TEAM' : '';
      const players = team.players.map(p => `  ${p.position} ${p.name}: ${p.value.toLocaleString()}`).join('\n');
      return `${team.name}${marker} [Total: ${team.totalValue.toLocaleString()}]\n${players}`;
    }).join('\n\n');

    // Build a flat player values lookup from 1QB values (all players, not just rostered)
    const playerValues = players
      .map(p => `${p.name}: ${p.value.toLocaleString()}`)
      .join('\n');

    const prompt = ANALYST_PROMPT
      .replace(/\{\{TEAM_NAME\}\}/g, myTeam.name)
      .replace(/\{\{LEAGUE_ROSTER_DATA\}\}/g, leagueRosterData)
      .replace(/\{\{PLAYER_VALUES\}\}/g, playerValues);

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
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
            const color = isUp ? '#00ff00' : '#e74c3c';
            const arrow = isUp ? '▲' : '▼';
            changeHtml = `<span style="color:${color}; font-size:12px; font-weight:bold;"> ${arrow} ${Math.abs(diff).toLocaleString()}</span>`;
          }
        }

        html += `
          <div style="margin: 6px 0; padding: 10px 12px; border-left: 4px solid #0066cc; background:#efefef; border-radius: 0px 8px 8px 8px;">
            <span style="font-weight:bold;">
              <a href="${player.link || '#'}" style="color:#0066cc; text-decoration:none;">${player.name}</a>
            </span>
            <span style="color:#555; font-size:13px; margin-left:8px;">${player.value.toLocaleString()}${changeHtml}</span>
          </div>
        `;
      });
    });
  }

  // ── LEAGUE-WIDE VALUE CHANGES ─────────────────────────────────────
  if (changes.valueChanges.length > 0) {
    html += `<h3 style="color: #f39c12; margin-top: 28px;">💰 Value Changes ±/- ${VALUE_CHANGE_THRESHOLD.toLocaleString()} (${changes.valueChanges.length})</h3>`;
    changes.valueChanges.forEach(change => {
      const isUp = change.diff > 0;
      const arrow = isUp ? '▲' : '▼';
      const color = isUp ? '#00ff00' : '#e74c3c';
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
    html += `<h3 style="color: #00ff00; margin-top: 28px;">✨ New Players in Rankings (${changes.added.length})</h3>`;
    changes.added.forEach(player => {
      html += `
        <div style="margin: 6px 0; padding: 10px 12px; border-left: 4px solid #00ff00; border-radius: 0px 8px 8px 8px; background:#efefef;">
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
      <div style="padding: 12px 16px; background: #f5eef8; border-left: 4px solid #6c3483; border-radius: 0px 8px 8px 8px; font-size: 14px; line-height: 1.6;">${aiAnalysis}</div>
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
  const previousPlayers = db.players || [];
  const previousPlayersMap = new Map(previousPlayers.map(p => [p.id, p]));
  console.log(`📚 Loaded ${previousPlayers.length} players from previous run`);

  // Step 2: Fetch league page data and rankings in parallel
  let leagueData;
  try {
    leagueData = await fetchLeaguePageData();
  } catch (err) {
    console.error('❌ Failed to fetch league page data:', err.message);
    leagueData = { leagueTeams: [], playersMap: new Map() };
  }

  const [rankingsResult, rosterPlayers] = await Promise.all([
    fetchAllPages(1),
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

  const currentPlayers = rankingsResult.players;

  if (currentPlayers.length === 0) {
    console.error('❌ No players fetched, aborting to avoid data loss');
    return;
  }

  // Step 3: Detect value changes
  console.log('\n🔍 Detecting changes...');
  const changes = detectChanges(previousPlayers, currentPlayers);

  console.log(`   👤 Roster players: ${rosterPlayers.length}`);
  console.log(`   ✨ New in rankings: ${changes.added.length}`);
  console.log(`   💰 Value changes (±${VALUE_CHANGE_THRESHOLD}+): ${changes.valueChanges.length}`);

  // Step 4: Run AI analysis + send email
  const allTeams = await fetchAllTeams(leagueData);
  const myTeam = allTeams.find(t => t.name === TeamName) ?? allTeams[0];
  const aiAnalysis = await fetchAIAnalysis(myTeam, allTeams, currentPlayers);
  const htmlContent = buildEmailHTML(changes, rosterPlayers, previousPlayersMap, aiAnalysis);
  await sendEmail(htmlContent);

  // Step 5: Save updated player values
  console.log(`💾 Saving ${currentPlayers.length} players to playerValues.json...`);
  db.players = currentPlayers;
  db.lastUpdated = new Date().toISOString();
  saveDatabase(db);

  console.log('============================================================');
  console.log('✅ Monitor run completed successfully');
}

// ============================================
// RUN THE MONITOR
// ============================================
monitor().catch(console.error);
