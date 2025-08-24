// agent/agent.js
const io = require('socket.io-client');
const si = require('systeminformation');
const os = require('os');
const { execSync } = require('child_process');

const SERVER = 'http://localhost:3000';
const socket = io(SERVER);

// ---------- scan helper ----------
async function scanSystem() {
  console.log('🔍 Starting full system scan…');
  try {
    const data = {
      system: await si.system(),
      bios:   await si.bios(),
      os:     await si.osInfo(),
      cpu:    await si.cpu(),
      mem:    await si.mem(),
      disks:  await si.diskLayout(),
      fs:     await si.fsSize(),
      graphics: await si.graphics(),
      network:  await si.networkInterfaces(),
      battery:  await si.battery()
    };

    // Windows extras
    if (os.platform() === 'win32') {
      try {
        data.drivers = execSync('driverquery /fo csv', { encoding: 'utf8', timeout: 5000 });
      } catch (e) { data.drivers = 'Driver scan skipped (admin needed)'; }

      try {
        data.eventErrors = execSync(
          'powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName=\'System\'; Level=2} -MaxEvents 5 | Format-Table TimeCreated, Id, Message -AutoSize"',
          { encoding: 'utf8', timeout: 5000 }
        );
      } catch (e) { data.eventErrors = 'Event log skipped (admin needed)'; }
    }

    socket.emit('system-report', data);
    console.log('✅ Full scan complete');
  } catch (err) {
    socket.emit('system-report', { error: err.message });
    console.error('❌ Scan error:', err.message);
  }
}

// Auto-repair after scan
socket.on('scan-repair', async () => {
  console.log('🔧 Auto-repair started');
  const os = require('os');
  const { execSync } = require('child_process');

  let log = '';
  try {
    if (os.platform() === 'win32') {
      log += 'Running sfc /scannow…\n';
      log += execSync('sfc /scannow', { encoding: 'utf8' });
      log += 'Running DISM RestoreHealth…\n';
      log += execSync('dism /online /cleanup-image /restorehealth', { encoding: 'utf8' });
      log += 'Updating all drivers…\n';
      log += execSync('winget upgrade --all --accept-source-agreements --silent', { encoding: 'utf8' });
    }
    if (os.platform() === 'linux') {
      log += 'Updating packages…\n';
      log += execSync('sudo apt update && sudo apt upgrade -y', { encoding: 'utf8' });
    }
    if (os.platform() === 'android') {
      log += 'Clearing bad caches…\n';
      execSync('pm clear-cache com.google.android.gms', { encoding: 'utf8' });
    }
  } catch (e) {
    log += 'Auto-fix error: ' + e.message;
  }
  socket.emit('log', log);
});

// ---------- connect ----------
socket.on('connect', () => {
  console.log('✅ Agent connected');
  scanSystem();          // auto-scan once
});

// optional keep-alive
setInterval(() => socket.emit('log', 'heartbeat'), 10000);