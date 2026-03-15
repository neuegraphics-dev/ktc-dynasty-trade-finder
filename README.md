# KTC Dynasty Trade Finder

Automated monitoring tool for [KeepTradeCut](https://keeptradecut.com) dynasty rankings.

**Tracks:**
- Player value changes
- New players added to rankings
- Players removed from rankings
- Price/value changes over time

---

## How It Works

- Fetches dynasty rankings from KTC on a weekly schedule (Fridays at 8 AM EST)
- Compares with previous run to detect changes
- Sends email notification via Gmail
- Stores current state in `data/playerValues.json`

---

## Setup

### Prerequisites
- Node.js 16+
- Gmail account with App Password enabled

### Installation

```bash
npm install
```

### Environment Variables

```
GMAIL_USER=your@gmail.com
GMAIL_PASS=your-app-password
GMAIL_TO_EMAIL=recipient@email.com
```

### Run Manually

```bash
npm run monitor
```

---

## GitHub Actions

The workflow runs automatically every Friday at 8 AM EST.

Add these secrets to your GitHub repository:
- `GMAIL_USER`
- `GMAIL_PASS`
- `GMAIL_TO_EMAIL`

---

## File Structure

```
ktc-dynasty-trade-finder/
├── ktc-monitor.js             # Main scraper + email script
├── server.js                  # Express API server
├── package.json
├── .github/workflows/
│   └── monitor.yml            # GitHub Actions automation
└── data/
    └── playerValues.json      # Current player values state
```

---

## API Endpoints

```
GET  /api/players              # Get current player values
GET  /api/health               # Health check
```
