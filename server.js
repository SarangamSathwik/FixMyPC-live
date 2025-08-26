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
    .card{background:#fff;border:1px solid #ccc;border-radius:0.5rem;padding:1rem;margin:0.5rem 0}
  </style>
</head>
<body>
  <h1>FixMyPC-Live – Cross-Network Auto-Scan & Repair</h1>

  <!-- Device list -->
  <div id="devices"></div>

  <!-- Downloads -->
  <h2>Downloads (EXE/APK)</h2>
  <a class="download" href="/agent/FixMyPC-Agent.exe" download>Windows Agent (EXE)</a><br>
  <a class="download" href="/agent/FixMyPC-Agent.apk" download>Android Agent (APK)</a>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const devicesDiv = document.getElementById('devices');

    socket.on('system-report', (data, id) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<h3>' + data.system.manufacturer + ' ' + data.system.model + '</h3>' +
        '<button onclick="repair(\'' + id + '\')">Auto-Repair</button>' +
        '<pre id="log-' + id + '"></pre>';
      devicesDiv.appendChild(card);
    });

    socket.on('repair-log', (log, id) => {
      document.getElementById('log-' + id).textContent = log;
    });

    function repair(id) {
      socket.emit('auto-fix', id);
    }
  </script>
</body>
</html>
  `);
});

app.use('/agent', express.static('agent'));

io.on('connection', socket => {
  console.log('🔗 Agent connected:', socket.id);
  socket.on('system-report', (data) => {
    io.emit('system-report', data, socket.id);
  });
  socket.on('auto-fix', async () => {
    let log = '';
    try {
      if (os.platform() === 'win32') {
        log += 'Updating drivers…\n' + execSync('winget upgrade --all --accept-source-agreements --silent', { encoding: 'utf8' });
        log += 'Running sfc…\n' + execSync('sfc /scannow', { encoding: 'utf8' });
      }
      if (os.platform() === 'linux') {
        log += 'Updating packages…\n' + execSync('sudo apt update -y && sudo apt upgrade -y', { encoding: 'utf8' });
      }
      if (os.platform() === 'android') {
        log += 'Clearing caches…\n' + execSync('pm clear-cache com.google.android.gms', { encoding: 'utf8' });
      }
    } catch (e) {
      log += '⚠️ ' + e.message;
    }
    io.emit('repair-log', log, socket.id);
  });
});

server.listen(PORT, () => console.log('✅ FixMyPC-Live server on port', PORT));