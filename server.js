// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

let lastReport = null; // persist most recent report (agent or client)

// Serve a tiny dashboard UI
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>FixMyPC-Live</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, Arial, sans-serif; margin: 2rem; max-width: 1100px; }
    .row { display: flex; gap: .75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    button { padding: .6rem 1rem; font-size: 1rem; cursor: pointer; border-radius: .6rem; border: 1px solid #9993; }
    pre { background: #0d1117; color: #c9d1d9; padding: 1rem; border-radius: .8rem; overflow-x: auto; max-height: 60vh; }
    .pill { background:#111827; color:#e5e7eb; padding:.2rem .6rem; border-radius:999px; font-size:.9rem; }
    .muted { opacity: .75; }
  </style>
</head>
<body>
  <h1>FixMyPC-Live Dashboard</h1>

  <div class="row">
    <div>Connections: <span id="count" class="pill">0</span></div>
    <span class="muted">(includes browsers + agents)</span>
  </div>

  <div class="row">
    <button id="scanAgentBtn" disabled>🖥️ Scan this PC (agent)</button>
    <button id="scanClientBtn">📱 Scan this device (browser)</button>
    <button id="downloadBtn" disabled>⬇️ Download JSON</button>
    <span id="status" class="pill">idle</span>
  </div>

  <pre id="report">Click a scan button to collect specs...</pre>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const countEl = document.getElementById('count');
    const scanAgentBtn = document.getElementById('scanAgentBtn');
    const scanClientBtn = document.getElementById('scanClientBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const statusEl = document.getElementById('status');
    const reportEl = document.getElementById('report');

    let connections = 0;
    let lastData = null;

    function enableDownloadIf(data){
      if (data) downloadBtn.disabled = false;
    }

    // Agent count (we're just counting all socket connections here)
    socket.on('agent-count', n => {
      connections = n;
      countEl.textContent = String(n);
      // Enable agent scan if at least one agent is connected.
      // NOTE: We can't perfectly distinguish browsers vs agents here without auth;
      // this demo enables when any connection is present to keep it simple.
      scanAgentBtn.disabled = (n === 0);
    });

    // Status logs
    socket.on('log', msg => {
      if (typeof msg === 'string' && msg.startsWith('agent:')) {
        statusEl.textContent = msg.replace('agent:', '');
      }
    });

    // Receive an agent-based system report
    socket.on('system-report', data => {
      statusEl.textContent = 'scan-complete (agent)';
      lastData = { source: 'agent', at: new Date().toISOString(), data };
      reportEl.textContent = JSON.stringify(lastData, null, 2);
      enableDownloadIf(lastData);
    });

    // Receive a client/browser-based report
    socket.on('client-report', data => {
      statusEl.textContent = 'scan-complete (browser)';
      lastData = { source: 'browser', at: new Date().toISOString(), data };
      reportEl.textContent = JSON.stringify(lastData, null, 2);
      enableDownloadIf(lastData);
    });

    // Buttons
    scanAgentBtn.addEventListener('click', () => {
      statusEl.textContent = 'scanning (agent)...';
      socket.emit('scan-now');
    });

    scanClientBtn.addEventListener('click', async () => {
      statusEl.textContent = 'scanning (browser)...';
      const data = await collectBrowserSpecs();
      socket.emit('client-report', data);
    });

    downloadBtn.addEventListener('click', () => {
      window.location.href = '/download';
    });

    // Minimal browser/mobile spec collector (works on phones & desktop)
    async function collectBrowserSpecs() {
      const nav = navigator;
      const scr = window.screen;
      const conn = nav.connection || {};
      let battery = {};
      try {
        if (nav.getBattery) {
          const b = await nav.getBattery();
          battery = {
            charging: b.charging,
            level: b.level,
            chargingTime: b.chargingTime,
            dischargingTime: b.dischargingTime
          };
        }
      } catch {}

      return {
        userAgent: nav.userAgent,
        platform: nav.platform,
        language: nav.language,
        languages: nav.languages,
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory, // undefined on iOS/Safari
        maxTouchPoints: nav.maxTouchPoints,
        screen: {
          width: scr.width,
          height: scr.height,
          availWidth: scr.availWidth,
          availHeight: scr.availHeight,
          colorDepth: scr.colorDepth,
          pixelRatio: window.devicePixelRatio
        },
        network: {
          downlink: conn.downlink,
          effectiveType: conn.effectiveType,
          rtt: conn.rtt,
          saveData: conn.saveData
        },
        battery
      };
    }
  </script>
</body>
</html>`);
});

// naive connection count
let connections = 0;
io.on('connection', socket => {
  connections++;
  io.emit('agent-count', connections);

  // re-broadcast logs and reports to all listeners (dashboard)
  socket.on('log', (msg) => io.emit('log', msg));

  socket.on('system-report', (data) => {
    lastReport = { source: 'agent', at: new Date().toISOString(), data };
    io.emit('system-report', data);
  });

  socket.on('client-report', (data) => {
    lastReport = { source: 'browser', at: new Date().toISOString(), data };
    io.emit('client-report', data);
  });

  socket.on('scan-now', () => io.emit('scan-now'));

  socket.on('disconnect', () => {
    connections--;
    io.emit('agent-count', connections);
  });
});

// download the last report as JSON
app.get('/download', (req, res) => {
  if (!lastReport) {
    return res.status(404).json({ error: 'No report yet. Run a scan first.' });
  }
  const filename = `fixmypc-report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(lastReport, null, 2));
});

server.listen(PORT, () => {
  console.log(`✅ FixMyPC-Live running on http://localhost:${PORT}`);
});
