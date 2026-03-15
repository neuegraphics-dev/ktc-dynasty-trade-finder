const express = require('express');
const fs = require('fs');
const path = require('path');
const { runMonitor, getDatabase } = require('./competitor-monitor');

const app = express();
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'playerValues.json');

app.use(express.json());
app.use(express.static('public'));

// API endpoint: Get current player values data
app.get('/api/players', (req, res) => {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return res.json({ competitors: {}, timestamp: null });
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    
    const response = {
      timestamp: data.lastUpdated,
      competitors: {
        'players': {
          players: data.players || [],
          changes: {
            added: [],
            removed: [],
            sold: [],
            pending: [],
            priceChanges: []
          },
          success: true
        }
      }
    };
    res.json(response);
  } catch (error) {
    console.error('Error reading player values:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Get detailed changes for a specific competitor
app.get('/api/competitor/:name', (req, res) => {
  try {
    const { name } = req.params;
    const data = getDatabase();

    if (!data.competitors[name]) {
      return res.status(404).json({ error: 'Competitor not found' });
    }

    res.json({
      name,
      boats: data.competitors[name],
      lastUpdated: data.lastUpdated
    });
  } catch (error) {
    console.error('Error fetching competitor details:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Trigger a manual monitor run
app.post('/api/monitor/run', async (req, res) => {
  try {
    const result = await runMonitor();
    res.json({
      success: true,
      message: 'Monitor run completed',
      result
    });
  } catch (error) {
    console.error('Error running monitor:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/players`);
});

module.exports = app;
