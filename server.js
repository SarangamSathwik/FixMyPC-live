// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

let lastTextReport = ''; // latest plain-text report from the agent

// ---- UI (one button, plain text area) ----
app.get('/', (_req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FixMyPC-Live</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, Arial, sans-serif; margin: 20px; max-width: 900px; line-height: 1.35; }
    .row { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
    button { padding:.6rem 1rem; font-size:1rem; cursor:pointer; border-radius:.6rem; border:1px solid #9993; }
    .pill { background:#111827; color:#e5e7eb; padding:.15rem .6rem; border-radius:999px; font-size:.9rem; }
    #report { white-space: pre-wrap; background: transparent; border:1px solid #9993; border-radius:.6rem; padding:12px; min-height:220px; }
    .muted { opacity:.75; }
  </style>
</head>
<body>
  <h1>FixMyPC-Live</h1>

  <div class="row">
    <div>Agents connected: <span id="count" class="pill">0</span></div>
    <span class="muted">(button enables when an agent is online)</span>
  </div>

  <div class="row">
    <button id="scanBtn" disabled>🔍 Scan Device (Agent)</button>
    <button id="downloadBtn" disabled>⬇️ Download Text</button>
    <span id="status" class="pill">idle</span>
  </div>

  <div id="report">Press “Scan Device (Agent)” to get a plain-text report…</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const countEl = document.getElementById('count');
    const scanBtn = document.getElementById('scanBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const statusEl = document.getElementById('status');
    const reportEl = document.getElementById('report');

    let connections = 0;

    socket.on('agent-count', function(n) {
      connections = n;
      countEl.textContent = String(n);
      scanBtn.disabled = (n === 0);
    });

    socket.on('log', function(msg) {
      if (typeof msg === 'string' && msg.indexOf('agent:') === 0) {
        statusEl.textContent = msg.replace('agent:', '');
      }
    });

    socket.on('text-report', function(text) {
      statusEl.textContent = 'scan-complete';
      reportEl.textContent = text || 'No data returned.';
      downloadBtn.disabled = !text;
    });

    scanBtn.addEventListener('click', function() {
      statusEl.textContent = 'scanning...';
      socket.emit('scan-now');
    });

    downloadBtn.addEventListener('click', function() {
      window.location.href = '/download';
    });
  </script>
</body>
</html>`);
});

// ---- sockets ----
let connections = 0;
io.on('connection', socket => {
  connections++;
  io.emit('agent-count', connections);

  socket.on('log', msg => io.emit('log', msg));

  socket.on('system-report', data => {
    lastTextReport = toPlainText(data);
    io.emit('text-report', lastTextReport);
  });

  socket.on('scan-now', () => io.emit('scan-now'));

  socket.on('disconnect', () => {
    connections--;
    io.emit('agent-count', connections);
  });
});

// ---- download as text ----
app.get('/download', (req, res) => {
  if (!lastTextReport) {
    return res.status(404).send('No report yet. Run a scan first.');
  }
  const filename = `fixmypc-report-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lastTextReport);
});

// ---- start server ----
server.listen(PORT, () => {
  console.log(`✅ FixMyPC-Live running on http://localhost:${PORT}`);
});

// ---- formatter: JSON -> human-readable plain text ----
function toPlainText(d) {
  if (!d || typeof d !== 'object') return 'No data.';

  const lines = [];
  const push = s => lines.push(s);

  const bytes = n => (typeof n === 'number' ? (n/1024/1024/1024).toFixed(2) + ' GB' : '');
  const pct = (a,b) => (a && b ? ((a/b)*100).toFixed(1) + '%' : '');

  const sys = d.system || {};
  const bios = d.bios || {};
  const os = d.os || {};
  push('=== DEVICE INFO ===');
  push('Manufacturer : ' + (sys.manufacturer || ''));
  push('Model        : ' + (sys.model || ''));
  push('Serial       : ' + (sys.serial || ''));
  push('BIOS         : ' + (bios.vendor || '') + ' ' + (bios.version || ''));
  push('OS           : ' + (os.distro || os.platform || '') + ' ' + (os.release || '') + ' (' + (os.arch || '') + ')');
  push('');

  const cpu = d.cpu || {};
  const mem = d.mem || {};
  push('=== CPU & MEMORY ===');
  push('CPU          : ' + (cpu.manufacturer || '') + ' ' + (cpu.brand || '') + ' @ ' + (cpu.speed || '') + ' GHz | Cores: ' + (cpu.cores || ''));
  if (mem.total) {
    push('RAM Total    : ' + bytes(mem.total));
    if (mem.used) push('RAM Used     : ' + bytes(mem.used) + ' (' + pct(mem.used, mem.total) + ')');
    if (mem.free) push('RAM Free     : ' + bytes(mem.free));
  }
  push('');

  const disks = Array.isArray(d.diskLayout) ? d.diskLayout : (d.disks || []);
  const fss = Array.isArray(d.fs) ? d.fs : (d.fsSize || []);
  push('=== STORAGE ===');
  (disks || []).forEach((x, i) => {
    push('Disk ' + (i+1) + '     : ' + (x.name || x.device || '') + ' | ' + (x.type || x.interfaceType || '') + ' | ' + bytes(x.size));
  });
  (fss || []).forEach((p) => {
    push('Partition   : ' + (p.fs || p.mount || '') + ' | Total: ' + bytes(p.size) + ' | Used: ' + bytes(p.used) + ' (' + pct(p.used, p.size) + ')');
  });
  push('');

  const g = d.graphics || {};
  const gcs = Array.isArray(g.controllers) ? g.controllers : [];
  push('=== GRAPHICS ===');
  if (gcs.length === 0) push('GPU          : (none reported)');
  gcs.forEach((c, i) => push('GPU ' + (i+1) + '      : ' + (c.model || '') + ' | VRAM: ' + (c.vram || '') + ' MB'));
  push('');

  const nics = Array.isArray(d.network) ? d.network : (d.networkInterfaces || []);
  push('=== NETWORK ===');
  (nics || []).forEach((n) => {
    push('IFACE       : ' + (n.iface || '') + ' | ' + (n.type || '') + ' | MAC: ' + (n.mac || ''));
    if (n.ip4) push('             IPv4: ' + n.ip4);
    if (n.ssid) push('             SSID: ' + n.ssid);
  });
  push('');

  const b = d.battery || {};
  push('=== BATTERY ===');
  if (b.hasbattery === false) {
    push('Battery      : Not present');
  } else {
    if (b.percent != null) push('Level       : ' + b.percent + '%');
    if (b.cyclecount != null) push('Cycles      : ' + b.cyclecount);
    if (b.ischarging != null) push('Charging    : ' + b.ischarging);
  }
  push('');

  if (d.driversCsv || d.eventErrors) {
    push('=== WINDOWS EXTRAS ===');
    if (d.driversCsv) {
      push('Drivers (CSV):');
      push(String(d.driversCsv).trim());
      push('');
    }
    if (d.eventErrors) {
      push('Last 5 System Errors:');
      push(String(d.eventErrors).trim());
      push('');
    }
  }

  push('=== END OF REPORT ===');
  return lines.join('\n');
}
