const io = require('socket.io-client');
const si = require('systeminformation');
const os = require('os');
const { execSync } = require('child_process');

const socket = io('http://localhost:3000'); // Change to Render URL for live

socket.on('connect', () => {
  console.log('🔗 Agent connected');
  socket.emit('scan-repair'); // Auto-scan on start
});