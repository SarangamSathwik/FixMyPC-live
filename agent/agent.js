const io = require('socket.io-client');
const si = require('systeminformation');
const os = require('os');
const { execSync } = require('child_process');

const SERVER = process.argv[2] || process.env.FMPCL_SERVER || 'http://localhost:3000';
const LABEL  = (process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label')+1] : '') || process.env.FMPC_LABEL || 'Unnamed-Device';
const TOKEN  = (process.argv.includes('--token') ? process.argv[process.argv.indexOf('--token')+1] : '') || process.env.FMPC_TOKEN || '';

const socket = io(SERVER, { transports: ['websocket'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });

socket.on('connect', () => {
  console.log('✅ Agent connected to', SERVER, 'as', LABEL);
  socket.emit('hello', { label: LABEL, platform: process.platform, token: TOKEN });
  socket.emit('log', 'agent:online');
});

socket.on('connect_error', (err) => {
  console.error('❌ connect_error:', err && (err.message || err.toString()));
});

socket.on('reconnect_attempt', (n) => {
  console.log('… reconnect_attempt #', n);
});

socket.on('disconnect', (reason) => {
  console.warn('⚠️  disconnected:', reason);
});

socket.on('scan-now', scanSystem);
setInterval(() => socket.emit('log', 'heartbeat'), 10000);

async function scanSystem() {
  const data = {};
  try {
    data.system   = await si.system();
    data.bios     = await si.bios();
    data.os       = await si.osInfo();
    data.cpu      = await si.cpu();
    data.mem      = await si.mem();
    data.diskLayout = await si.diskLayout();
    data.fs       = await si.fsSize();
    data.graphics = await si.graphics();
    data.network  = await si.networkInterfaces();
    data.battery  = await si.battery();

    if (os.platform() === 'win32') {
      try {
        data.driversCsv = execSync('driverquery /fo csv', { stdio: ['ignore','pipe','pipe'] }).toString();
      } catch { data.driversCsv = 'driverquery failed (needs admin?)'; }
      try {
        data.eventErrors = execSync(
          'powershell -NoLogo -NoProfile "Get-WinEvent -FilterHashtable @{LogName=\'System\'; Level=2} -MaxEvents 5 | Format-Table TimeCreated, Id, Message -AutoSize"',
          { stdio: ['ignore','pipe','pipe'] }
        ).toString();
      } catch { data.eventErrors = 'Event Log read failed (needs admin?)'; }
    }

    data.deviceLabel = LABEL;
    socket.emit('system-report', data);
    socket.emit('log', 'agent:scan-complete');
    console.log('✅ scan sent');
  } catch (err) {
    console.error('❌ scan error:', err && err.message);
    socket.emit('log', 'agent:scan-error ' + (err && err.message));
  }
}
