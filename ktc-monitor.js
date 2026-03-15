const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

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
// DATABASE SETUP
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'playerValues.json');

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
 * Fetch my roster from the KTC team breakdown page.
 * Returns players grouped with their position, current value, and link.
 */
async function fetchMyRoster() {
  try {
    console.log('\n👤 Fetching my roster...');
    const response = await axios.get(ROSTER_URL(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const $ = cheerio.load(response.data);
    const $wrap = $('#power-rankings-league-team-breakdown-wrap .tb-roster-inner-wrap');

    if ($wrap.length === 0) {
      console.warn('⚠️ Roster container not found');
      return [];
    }

    const players = [];

    $wrap.find('.pr-team-players-block').each((_, block) => {
      const $block = $(block);
      const position = $block.find('.pr-team-players-block-header > div').first().text().trim();

      $block.find('.team-player-name > p > a').each((_, playerEl) => {
        const $player = $(playerEl);
        const name = $player.text().trim();
        const linkHref = $player.attr('href');
        const link = linkHref ? (linkHref.startsWith('http') ? linkHref : 'https://keeptradecut.com' + linkHref) : null;

        // Value sits in the sibling .team-player-info within the same player row
        const $row = $player.closest('.team-player-name').siblings('.team-player-info');
        const valueText = $row.find('.team-player-value p').first().text().trim();
        const value = parseInt(valueText, 10) || 0;

        if (name) {
          players.push({ id: getplayerId(name), name, position, value, link });
        }
      });
    });

    console.log(`✅ Fetched ${players.length} roster players`);
    return players;

  } catch (error) {
    console.error('❌ Error fetching roster:', error.message);
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
// EMAIL FUNCTIONS
// ============================================

/**
 * Build HTML email content.
 * Always starts with the full roster section, then league-wide value changes and new players.
 */
function buildEmailHTML(changes, rosterPlayers, previousPlayersMap) {
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
            <span style="color:#555; font-size:13px; margin-left:8px;">${player.value.toLocaleString()}${changeHtml}</span>
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

  // Step 2: Fetch rankings + roster in parallel
  const [rankingsResult, rosterPlayers] = await Promise.all([
    fetchAllPages(),
    fetchMyRoster()
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

  // Step 4: Send email (always — roster is always included)
  const htmlContent = buildEmailHTML(changes, rosterPlayers, previousPlayersMap);
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
