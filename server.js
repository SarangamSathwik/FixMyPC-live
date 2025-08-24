// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>FixMyPC-Live</title>
  <style>
    body{font-family:Consolas,monospace;background:#f7f7f7;color:#111;margin:2em}
    button{padding:0.6em 1.2em;font-size:1em;background:#0078d4;color:#fff;border:none;cursor:pointer}
    pre{white-space:pre-wrap;font-size:14px;background:#fff;border:1px solid #ccc;padding:1em}
  </style>
</head>
<body>
  <h1>FixMyPC-Live – Auto Scan & Repair</h1>
  <button id="scanBtn" disabled>Scan & Repair</button>
  <pre id="report">Click "Scan & Repair" to start…</pre>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const scanBtn = document.getElementById('scanBtn');
    const report = document.getElementById('report');
    socket.on('agent-count', n => scanBtn.disabled = n === 0);
    scanBtn.onclick = () => socket.emit('scan-repair');
    socket.on('system-report', data => {
      const gb = b => (b / 1024 / 1024 / 1024).toFixed(1);
      let txt = '';
      txt += 'System Summary\n--------------\n';
      txt += 'Manufacturer : ' + data.system.manufacturer + '\n';
      txt += 'Model        : ' + data.system.model + '\n';
      txt += 'Serial       : ' + data.system.serial + '\n';
      txt += 'BIOS         : ' + data.bios.version + ' (' + data.bios.releaseDate + ')\n\n';
      txt += 'Operating System\n----------------\n';
      txt += 'Name    : ' + data.os.distro + '\n';
      txt += 'Version : ' + data.os.release + ' (Build ' + data.os.build + ')\n';
      txt += 'Arch    : ' + data.os.arch + '\n\n';
      txt += 'Processor\n---------\n';
      txt += 'Name  : ' + data.cpu.brand + '\n';
      txt += 'Cores : ' + data.cpu.physicalCores + ' Physical / ' + data.cpu.cores + ' Logical\n\n';
      txt += 'Memory (RAM)\n------------\n';
      const usedGB = gb(data.mem.used);
      const totalGB = gb(data.mem.total);
      txt += 'Total : ' + totalGB + ' GB\n';
      txt += 'Used  : ' + usedGB + ' GB (' + Math.round(data.mem.used / data.mem.total * 100) + '%)\n\n';
      txt += 'Storage\n-------\n';
      data.fs.forEach(f => {
        txt += f.mount + '  ' + totalGB + ' GB total | ' + usedGB + ' GB used | ' + gb(f.available) + ' GB free\n';
      });
      if (data.battery.hasBattery) {
        txt += '\nBattery\n-------\n';
        txt += 'Design   : ' + (data.battery.designedCapacity / 1000).toFixed(1) + ' Wh\n';
        txt += 'Charge   : ' + data.battery.percent + '%\n';
        txt += 'Cycles   : ' + (data.battery.cycleCount || 0) + '\n';
      }
      txt += '\nGraphics\nAdapter  : ' + (data.graphics.controllers[0] ? data.graphics.controllers[0].name : 'Intel Iris Xe') + '\n';
      txt += '\nNetwork\n';
      data.network.filter(n => n.iface !== 'Loopback').forEach(n => {
        txt += n.iface + ' | IP ' + n.ip4 + ' | MAC ' + n.mac + '\n';
      });
      txt += '\nRecent System Errors\n--------------------\n';
      const errs = data.eventErrors.split('\n').filter(l => l.trim()).slice(0, 5);
      txt += errs.join('\n');
      report.textContent = txt;
    });
  </script>
</body>
</html>
  `);
});

io.on('connection', socket => {
  console.log('🔗 Agent connected');
  socket.on('scan-repair', async () => {
    console.log('🔧 Auto-repair started');
    let log = '';
    try {
      if (os.platform() === 'win32') {
        log += 'Running sfc /scannow…\n';
        log += require('child_process').execSync('sfc /scannow', { encoding: 'utf8' });
        log += 'Running DISM RestoreHealth…\n';
        log += require('child_process').execSync('dism /online /cleanup-image /restorehealth', { encoding: 'utf8' });
        log += 'Updating drivers…\n';
        log += require('child_process').execSync('winget upgrade --all --accept-source-agreements --silent', { encoding: 'utf8' });
      }
      if (os.platform() === 'linux') {
        log += 'Updating packages…\n';
        log += require('child_process').execSync('sudo apt update && sudo apt upgrade -y', { encoding: 'utf8' });
      }
      if (os.platform() === 'android') {
        log += 'Clearing caches…\n';
        require('child_process').execSync('pm clear-cache com.google.android.gms', { encoding: 'utf8' });
      }
    } catch (e) {
      log += '⚠️ ' + e.message;
    }
    socket.emit('log', log);
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log('✅ FixMyPC-Live server on port', process.env.PORT || 3000)
);