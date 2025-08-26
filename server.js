const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const os = require('os');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// Serve the main page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>FixMyPC-Live</title>
  <style>
    body { font-family: Consolas, monospace; background: #f7f7f7; color: #111; margin: 2em; }
    h1 { font-size: 1.5em; }
    button { padding: 0.6em 1.2em; font-size: 1em; background: #0078d4; color: #fff; border: none; cursor: pointer; margin: 0.5em 0; }
    button:hover { background: #005a9e; }
    pre { white-space: pre-wrap; font-size: 14px; background: #fff; border: 1px solid #ccc; padding: 1em; border-radius: 4px; }
    @media (max-width: 600px) { body { margin: 1em; } h1 { font-size: 1.2em; } }
  </style>
</head>
<body>
  <h1>FixMyPC-Live – Auto Scan & Repair</h1>
  <button id="scanBtn">Scan & Repair This Device</button>
  <pre id="report">Click "Scan & Repair This Device" to start…</pre>
  <h2>Data Rescue (Connect Cable)</h2>
  <button id="rescueBtn">Connect via USB-C & Copy Data</button>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const scanBtn = document.getElementById('scanBtn');
    const rescueBtn = document.getElementById('rescueBtn');
    const report = document.getElementById('report');

    scanBtn.onclick = () => socket.emit('scan-repair');
    rescueBtn.onclick = async () => {
      try {
        const device = await navigator.usb.requestDevice({ filters: [] });
        await device.open();
        socket.emit('data-rescue', device.productName || 'USB Device');
      } catch (e) {
        report.textContent += '\\n⚠️ USB Error: ' + e.message;
      }
    };

    socket.on('system-report', data => {
      const gb = b => (b / 1024 / 1024 / 1024).toFixed(1);
      let txt = 'System Summary\\n--------------\\n';
      txt += 'Manufacturer : ' + (data.system.manufacturer || 'Unknown') + '\\n';
      txt += 'Model        : ' + (data.system.model || 'Unknown') + '\\n';
      txt += 'Serial       : ' + (data.system.serial || 'N/A') + '\\n';
      txt += 'BIOS         : ' + (data.bios.version || 'N/A') + ' (' + (data.bios.releaseDate || 'N/A') + ')\\n\\n';
      txt += 'Operating System\\n----------------\\n';
      txt += 'Name    : ' + (data.os.distro || 'Unknown') + '\\n';
      txt += 'Version : ' + (data.os.release || 'N/A') + ' (Build ' + (data.os.build || 'N/A') + ')\\n';
      txt += 'Arch    : ' + (data.os.arch || 'N/A') + '\\n\\n';
      txt += 'Processor\\n---------\\n';
      txt += 'Name  : ' + (data.cpu.brand || 'Unknown') + '\\n';
      txt += 'Cores : ' + (data.cpu.physicalCores || 'N/A') + ' Physical / ' + (data.cpu.cores || 'N/A') + ' Logical\\n\\n';
      txt += 'Memory (RAM)\\n------------\\n';
      const usedGB = gb(data.mem.used || 0);
      const totalGB = gb(data.mem.total || 0);
      txt += 'Total : ' + totalGB + ' GB\\n';
      txt += 'Used  : ' + usedGB + ' GB (' + (data.mem.total ? Math.round(data.mem.used / data.mem.total * 100) : 'N/A') + '%)\\n\\n';
      txt += 'Storage\\n-------\\n';
      (data.fs || []).forEach(f => {
        txt += f.mount + '  ' + gb(f.size) + ' GB total | ' + gb(f.used) + ' GB used | ' + gb(f.available) + ' GB free\\n';
      });
      if (data.battery.hasBattery) {
        txt += '\\nBattery\\n-------\\n';
        txt += 'Design   : ' + ((data.battery.designedCapacity || 0) / 1000).toFixed(1) + ' Wh\\n';
        txt += 'Charge   : ' + (data.battery.percent || 'N/A') + '%\\n';
        txt += 'Cycles   : ' + (data.battery.cycleCount || 0) + '\\n';
      }
      txt += '\\nGraphics\\nAdapter  : ' + (data.graphics.controllers[0] ? data.graphics.controllers[0].name : 'Unknown') + '\\n';
      txt += '\\nNetwork\\n';
      (data.network || []).filter(n => n.iface !== 'Loopback').forEach(n => {
        txt += n.iface + ' | IP ' + (n.ip4 || 'N/A') + ' | MAC ' + (n.mac || 'N/A') + '\\n';
      });
      txt += '\\nRecent System Errors\\n--------------------\\n';
      const errs = (data.eventErrors || '').split('\\n').filter(l => l.trim()).slice(0, 5);
      txt += errs.length ? errs.join('\\n') : 'No recent errors found.';
      report.textContent = txt;
    });

    socket.on('repair-log', log => {
      report.textContent += '\\n--- Repair Log ---\\n' + log;
    });

    socket.on('data-rescue', device => {
      report.textContent += '\\n--- Data Rescue ---\\nConnected device: ' + device;
    });
  </script>
</body>
</html>
  `);
});

io.on('connection', socket => {
  console.log('🔗 Connected');
  socket.on('scan-repair', async () => {
    try {
      const data = {
        system: await si.system(),
        bios: await si.bios(),
        os: await si.osInfo(),
        cpu: await si.cpu(),
        mem: await si.mem(),
        fs: await si.fsSize(),
        battery: await si.battery(),
        graphics: await si.graphics(),
        network: await si.networkInterfaces(),
        eventErrors: (os.platform() === 'win32' ? execSync('wevtutil qe System /c:5 /rd:true /f:text', { encoding: 'utf8' }) : 'N/A')
      };
      socket.emit('system-report', data);
      let log = '';
      if (os.platform() === 'win32') {
        try {
          log += 'Updating drivers…\n' + execSync('winget upgrade --all --accept-source-agreements --silent', { encoding: 'utf8' });
          log += 'Running sfc…\n' + execSync('sfc /scannow', { encoding: 'utf8' });
        } catch (e) {
          log += '⚠️ Repair error: ' + e.message + '\n';
        }
      } else {
        log += 'Repairs only supported on Windows.\n';
      }
      socket.emit('repair-log', log);
    } catch (e) {
      socket.emit('repair-log', '⚠️ Scan error: ' + e.message);
    }
  });
  socket.on('data-rescue', device => {
    socket.emit('data-rescue', device || 'Unknown device');
  });
});

server.listen(PORT, () => console.log('✅ Server on port', PORT));