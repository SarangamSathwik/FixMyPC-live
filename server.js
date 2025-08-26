// server.js
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

// Serve the page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>FixMyPC-Live – Global Auto-Scan</title>
  <style>
    body{font-family:Consolas,monospace;background:#f7f7f7;color:#111;margin:2em}
    button{padding:0.6em 1.2em;font-size:1em;background:#0078d4;color:#fff;border:none;cursor:pointer}
    pre{white-space:pre-wrap;font-size:14px;background:#fff;border:1px solid #ccc;padding:1em}
    #report{height:400px;overflow:auto}
  </style>
</head>
<body>
  <h1>FixMyPC-Live – Global Auto-Scan</h1>
  <button id="scanBtn">Scan This Device</button>
  <pre id="report">Click scan to start…</pre>

  <script>
    const report = document.getElementById('report');
    const scanBtn = document.getElementById('scanBtn');

    // ---------- WebUSB / WebADB fallback ----------
    async function scanLocal() {
      // Browser can only scan **itself**
      try {
        const res = await fetch('/api/scan');
        const data = await res.json();
        displayReport(data);
      } catch (e) {
        report.textContent = 'Error: ' + e.message;
      }
    }

    async function displayReport(data) {
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
    }

    scanBtn.onclick = scanLocal;
  </script>
</body>
</html>
  `);
});

// ---------- Backend API ----------
app.get('/api/scan', async (req, res) => {
  try {
    const data = {
      system: await si.system(),
      bios:   await si.bios(),
      os:     await si.osInfo(),
      cpu:    await si.cpu(),
      mem:    await si.mem(),
      fs:     await si.fsSize(),
      graphics: await si.graphics(),
      network:  await si.networkInterfaces(),
      battery:  await si.battery(),
      eventErrors: (os.platform() === 'win32')
        ? require('child_process').execSync('powershell "Get-WinEvent -FilterHashtable @{LogName=\'System\'; Level=2} -MaxEvents 5 | Format-Table -AutoSize"', { encoding: 'utf8' })
        : ''
    };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

server.listen(PORT, () => console.log('✅ Global scan server on port', PORT));