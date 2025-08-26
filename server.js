const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

let lastTextReport = '';

app.use(express.static('public')); // serve /public (for downloads page, EXE/APK)

app.get('/', (_req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>FixMyPC-Live</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, Arial, sans-serif; margin: 20px; max-width: 1000px; line-height: 1.38; }
    .row { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
    select,button { padding:.55rem .9rem; font-size:1rem; border-radius:.6rem; border:1px solid #9993; }
    .pill { background:#111827; color:#e5e7eb; padding:.15rem .6rem; border-radius:999px; font-size:.9rem; }
    #report { white-space: pre-wrap; background: transparent; border:1px solid #9993; border-radius:.6rem; padding:12px; min-height:260px; }
    a.btn { text-decoration:none; display:inline-block; }
    .muted { opacity:.75; }
  </style>
</head>
<body>
  <h1>FixMyPC-Live</h1>

  <div class="row">
    <div>Agents online: <span id="count" class="pill">0</span></div>
    <a class="btn" href="/downloads.html" target="_blank">Downloads (EXE/APK)</a>
    <span class="muted">Install the agent once per device; then control scans here.</span>
  </div>

  <div class="row">
    <select id="agentSelect">
      <option value="">— All devices —</option>
    </select>
    <button id="scanBtn" disabled>🔍 Scan Selected</button>
    <button id="downloadBtn" disabled>⬇️ Download Text</button>
    <span id="status" class="pill">idle</span>
  </div>

  <div id="report">Press “Scan Selected” to get a plain-text report…</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const countEl = document.getElementById('count');
    const agentSelect = document.getElementById('agentSelect');
    const scanBtn = document.getElementById('scanBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const statusEl = document.getElementById('status');
    const reportEl = document.getElementById('report');

    socket.on('agent-count', function(n) {
      countEl.textContent = String(n);
    });

    socket.on('agents', function(list) {
      const cur = agentSelect.value;
      agentSelect.innerHTML = '<option value="">— All devices —</option>';
      list.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = (a.label || 'Unnamed') + ' (' + (a.platform || '?') + ')';
        agentSelect.appendChild(opt);
      });
      scanBtn.disabled = list.length === 0;
      if ([...agentSelect.options].some(o => o.value === cur)) agentSelect.value = cur;
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
      const id = agentSelect.value;
      if (id) socket.emit('scan-one', id);
      else socket.emit('scan-now');
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
const agents = new Map(); // socket.id -> { label, platform }

io.on('connection', socket => {
  connections++;
  io.emit('agent-count', connections);

  socket.on('hello', (info) => {
    agents.set(socket.id, { label: info?.label || 'Unnamed', platform: info?.platform || '' });
    broadcastAgents();
    // auto-scan on connect? uncomment next line:
    // socket.emit('scan-now');
  });

  socket.on('log', msg => io.emit('log', msg));

  socket.on('system-report', data => {
    const meta = agents.get(socket.id);
    if (meta) data.deviceLabel = meta.label;
    const text = toPlainText(data);
    lastTextReport = text;
    io.emit('text-report', text);
  });

  socket.on('scan-now', () => {
    for (const id of agents.keys()) io.to(id).emit('scan-now');
  });

  socket.on('scan-one', (id) => {
    if (agents.has(id)) io.to(id).emit('scan-now');
  });

  socket.on('disconnect', () => {
    connections--;
    agents.delete(socket.id);
    io.emit('agent-count', connections);
    broadcastAgents();
  });

  function broadcastAgents() {
    const list = [...agents.entries()].map(([id, a]) => ({ id, label: a.label, platform: a.platform }));
    io.emit('agents', list);
  }
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
  if (d.deviceLabel) push('Device Label : ' + d.deviceLabel);
  push('Manufacturer : ' + (sys.manufacturer || ''));
  push('Model        : ' + (sys.model || ''));
  push('Serial       : ' + (sys.serial || ''));
  push('BIOS         : ' + (bios.vendor || '') + ' ' + (bios.version || ''));
  push('OS           : ' + (os.distro || os.platform || '') + ' ' + (os.release || '') + ' (' + (os.arch || '') + ')');
  push('');

  const cpu = d.cpu || {};
  const mem = d.mem || {};
  push('=== CPU & MEMORY ===');
  push('CPU          : ' + (cpu.manufacturer || '') + ' ' + (cpu.brand || '') + (cpu.speed ? (' @ ' + cpu.speed + ' GHz') : '') + ' | Cores: ' + (cpu.cores || ''));
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
  return lines.join('\\n');
}
