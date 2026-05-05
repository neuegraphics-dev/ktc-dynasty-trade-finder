// ============================================================
// EDIT THIS SECTION BEFORE EACH RUN
// ============================================================

const MY_TEAM = "Montreal Moonshiners";

const TRADE_PARTNERS = "Loser";

const TRADE_NOTES = `
Trade Block (confirmed available):

Loser: 1.08, 2.08, 3.01, DJ Moore (for and upgrade), chubba hubbard, cortland sutton
Moonshiners: Caleb Williams, 2.05


Manager Tendencies:
| Manager | Willing to Move | Wants | Notes |
|---------|----------------|-------|-------|

Loser: Doesn't like the 2026 draft, wants to move back or get a player for 1.08. Likes 2027 draft year more for higher upside.

Moonshiners: Likes the draft but does not overvalue first round picks for starting roster pieces. Interested in moving up in the 2026 draft. Desperately need RB3 upgrade. Looking for startable depth pieces.
`;

// ============================================================
// PROMPT — no need to edit below this line
// ============================================================

const custom_analyzer = `You are a sharp, opinionated dynasty fantasy football trade analyst. Generate exactly 10 win/win trade proposals between ${MY_TEAM} and ${TRADE_PARTNERS}. No analysis sections, no introductions — trades only.

League format: 12-team, .5PPR, 1QB (6pt passing TD), start 1QB/2RB/3WR/1TE/1FLEX, 13 bench.
Age cliff thresholds: RB = 28+, WR/TE = 31+

Here is the league roster data for all teams:
<league_roster_data>
{{LEAGUE_ROSTER_DATA}}
</league_roster_data>

Here is the player values data from Keep Trade Cut (1QB format — use these for all trade valuations):
<player_values>
{{PLAYER_VALUES}}
</player_values>

Here are the trade interest notes for this session:
<trade_notes>
${TRADE_NOTES}
</trade_notes>

---

**TRADE CONSTRUCTION RULES:**
- Use KTC values from the provided data as the PRIMARY basis. Do not guess or invent values.
- Every trade must benefit BOTH sides based on their actual roster needs.
- Value differential must stay within 10%. If a trade is close but over the threshold, add a future pick (e.g. 2027 3rd) or a depth piece from the higher-value side to close the gap — do not leave lopsided trades.
- In 2-for-1 trades, the team receiving the single asset must get the largest piece.
- At least 2 trades must involve draft pick capital.
- At least 1 trade must be a 3-player+ package.
- Cross-reference trade_notes for feasibility — do NOT just repackage the notes as trade ideas.
- ASSET DIVERSITY RULE: No single player may appear on ${MY_TEAM}'s side in more than 2 of the 10 trades. Spread the trade assets across the full roster.
- Vary the trades across the spectrum: fair-value swaps, pick-heavy deals, consolidations, depth-for-depth.

---

Output a single HTML email. Inline CSS only — no classes, no style blocks.

Wrap the entire output in:
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;"><tr><td>

Open with a single header card:
<table width="100%" cellpadding="20" cellspacing="0" style="background:#0066cc;border-radius:8px;margin-bottom:16px;"><tr><td>
<h1 style="margin:0;font-size:20px;color:#ffffff;">${MY_TEAM} × ${TRADE_PARTNERS} — Trade Ideas</h1>
<p style="margin:4px 0 0;font-size:13px;color:#cce0ff;">Based on current KTC values and trade interest notes</p>
</td></tr></table>

Then for each of the 10 trades, output one card:
<table width="100%" cellpadding="20" cellspacing="0" style="background:#ffffff;border-radius:8px;margin-bottom:12px;border:1px solid #e0e0e0;"><tr><td>

<p style="margin:0 0 10px;font-size:14px;font-weight:bold;color:#1a1a1a;">Trade [#] — [short title, e.g. "Williams + Pick for DJ Moore"]</p>

<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px;margin-bottom:10px;">
  <tr style="background:#0066cc;color:#ffffff;">
    <th style="text-align:left;padding:8px 10px;width:50%;border-radius:4px 0 0 0;">${MY_TEAM} Gives</th>
    <th style="text-align:left;padding:8px 10px;width:50%;border-radius:0 4px 0 0;">[Partner] Gives</th>
  </tr>
  <tr style="background:#f9f9f9;">
    <td style="padding:8px 10px;border-bottom:1px solid #e8e8e8;color:#333;">Player / Pick (KTC value)</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e8e8e8;color:#333;">Player / Pick (KTC value)</td>
  </tr>
  <tr>
    <td style="padding:8px 10px;font-weight:bold;color:#1a1a1a;">Total: X</td>
    <td style="padding:8px 10px;font-weight:bold;color:#1a1a1a;">Total: X</td>
  </tr>
</table>

<p style="margin:3px 0;font-size:13px;color:#333;"><strong style="color:#0066cc;">${MY_TEAM}:</strong> [why this works in 1 sentence]</p>
<p style="margin:3px 0;font-size:13px;color:#333;"><strong style="color:#555;">[Partner]:</strong> [why this works in 1 sentence]</p>
<p style="margin:6px 0 0;font-size:12px;color:#888;">Value gap: [X%] &nbsp;·&nbsp; Feasibility: 🟢 Likely / 🟡 Possible / 🔴 Long Shot</p>

</td></tr></table>

Close with:
</td></tr></table></body></html>

**Keep response within 8,000 tokens.**`;

module.exports = custom_analyzer;
