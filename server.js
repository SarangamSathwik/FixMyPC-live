const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

let lastTextReport = '';

app.use(express.static('public')); // serve /public (for downloads page, EXE/APK)

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>FixMyPC-Live</title>
  <style>
    body{font-family:Consolas,monospace;background:#f7f7f7;color:#111;margin:2em}
    pre{white-space:pre-wrap;font-size:14px;background:#fff;border:1px solid #ccc;padding:1em}
  </style>
</head>
<body>
  <h1>FixMyPC-Live – Auto Scan</h1>
  <pre id="report">Auto-scanning…</pre>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const report = document.getElementById('report');

    // 1. When this page loads, the agent emits "auto-scan"
    socket.on('connect', () => {
      socket.emit('auto-scan');
    });

    // 2. Display the full report instantly
    socket.on('system-report', data => {
      const gb = b => (b / 1024 / 1024 / 1024).toFixed(1);
      let txt = '';
      txt += 'System Summary\\n--------------\\n';
      txt += 'Manufacturer : ' + data.system.manufacturer + '\\n';
      txt += 'Model        : ' + data.system.model + '\\n';
      txt += 'Serial       : ' + data.system.serial + '\\n';
      txt += 'BIOS         : ' + data.bios.version + ' (' + data.bios.releaseDate + ')\\n\\n';

      txt += 'Operating System\\n----------------\\n';
      txt += 'Name    : ' + data.os.distro + '\\n';
      txt += 'Version : ' + data.os.release + ' (Build ' + data.os.build + ')\\n';
      txt += 'Arch    : ' + data.os.arch + '\\n\\n';

      txt += 'Processor\\n---------\\n';
      txt += 'Name  : ' + data.cpu.brand + '\\n';
      txt += 'Cores : ' + data.cpu.physicalCores + ' Physical / ' + data.cpu.cores + ' Logical\\n\\n';

      txt += 'Memory (RAM)\\n------------\\n';
      const usedGB = gb(data.mem.used);
      const totalGB = gb(data.mem.total);
      txt += 'Total : ' + totalGB + ' GB\\n';
      txt += 'Used  : ' + usedGB + ' GB (' + Math.round(data.mem.used / data.mem.total * 100) + '%)\\n\\n';

      txt += 'Storage\\n-------\\n';
      data.fs.forEach(f => {
        txt += f.mount + '  ' + gb(f.size) + ' GB total | ' + gb(f.used) + ' GB used | ' + gb(f.available) + ' GB free\\n';
      });

      if (data.battery.hasBattery) {
        txt += '\\nBattery\\n-------\\n';
        txt += 'Design   : ' + (data.battery.designedCapacity / 1000).toFixed(1) + ' Wh\\n';
        txt += 'Charge   : ' + data.battery.percent + '%\\n';
        txt += 'Cycles   : ' + (data.battery.cycleCount || 0) + '\\n';
      }

      txt += '\\nGraphics\\nAdapter  : ' + (data.graphics.controllers[0] ? data.graphics.controllers[0].name : 'Intel Iris Xe') + '\\n';
      txt += '\\nNetwork\\n';
      data.network.filter(n => n.iface !== 'Loopback').forEach(n => {
        txt += n.iface + ' | IP ' + n.ip4 + ' | MAC ' + n.mac + '\\n';
      });

      txt += '\\nRecent System Errors\\n--------------------\\n';
      const errs = data.eventErrors.split('\\n').filter(l => l.trim()).slice(0, 5);
      txt += errs.join('\\n');
      report.textContent = txt;
    });
  </script>
</body>
</html>
  `);
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
