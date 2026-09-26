// DiscordBuddy Rich Presence helper (copied into the support folder by
// DiscordBuddy.jsx on Start — edit this file, not the copy).
// Runs outside After Effects, mirrors state.json to the Discord desktop
// client over its local IPC socket, and exits when the panel stops or
// After Effects goes away. Zero dependencies.
'use strict';
var net = require('net');
var fs = require('fs');
var path = require('path');

var DIR = __dirname;
var STATE_FILE = path.join(DIR, 'state.json');
var CONFIG_FILE = path.join(DIR, 'config.json');
var PID_FILE = path.join(DIR, 'helper.pid');
var LOG_FILE = path.join(DIR, 'helper.log');
var STALE_SECS = 75; // no heartbeat from the panel for this long = AE is gone

function log(msg) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 200000) fs.unlinkSync(LOG_FILE);
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + '  ' + msg + '\n');
  } catch (e) {}
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// single instance: if a previous helper is still alive, leave it to it
try {
  var oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (oldPid > 0) { process.kill(oldPid, 0); log('already running as pid ' + oldPid + ', exiting'); process.exit(0); }
} catch (e0) {}
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e1) {}

var config = readJSON(CONFIG_FILE) || {};
if (!config.clientId) { log('no clientId in config.json, exiting'); process.exit(1); }

function ipcCandidates() {
  var out = [], i, d;
  if (process.platform === 'win32') {
    for (i = 0; i < 10; i++) out.push('\\\\?\\pipe\\discord-ipc-' + i);
  } else {
    var dirs = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, '/tmp'];
    var seen = {};
    for (d = 0; d < dirs.length; d++) {
      if (!dirs[d] || seen[dirs[d]]) continue;
      seen[dirs[d]] = true;
      for (i = 0; i < 10; i++) out.push(path.join(dirs[d], 'discord-ipc-' + i));
    }
  }
  return out;
}

// Discord IPC framing: little-endian int32 opcode, int32 length, JSON payload
function frame(op, obj) {
  var json = Buffer.from(JSON.stringify(obj), 'utf8');
  var buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

var sock = null, ready = false, pending = Buffer.alloc(0), nonce = 0, lastSent = '';

function connect(list, idx) {
  if (idx >= list.length) {
    log('Discord IPC socket not found (is the Discord desktop app running?), retrying in 15s');
    setTimeout(function () { connect(ipcCandidates(), 0); }, 15000);
    return;
  }
  var s = net.connect(list[idx]);
  s.on('connect', function () {
    sock = s;
    pending = Buffer.alloc(0);
    s.write(frame(0, { v: 1, client_id: String(config.clientId) })); // handshake
  });
  s.on('data', function (chunk) { onData(s, chunk); });
  s.on('error', function () { if (sock !== s) connect(list, idx + 1); });
  s.on('close', function () {
    if (sock === s) {
      sock = null; ready = false; lastSent = '';
      log('connection closed, reconnecting in 15s');
      setTimeout(function () { connect(ipcCandidates(), 0); }, 15000);
    }
  });
}

function onData(s, chunk) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 8) {
    var len = pending.readInt32LE(4);
    if (pending.length < 8 + len) break;
    var op = pending.readInt32LE(0);
    var payload = pending.slice(8, 8 + len).toString('utf8');
    pending = pending.slice(8 + len);
    handle(s, op, payload);
  }
}

function handle(s, op, payload) {
  var msg = null;
  try { msg = JSON.parse(payload); } catch (e) {}
  if (op === 1 && msg && msg.evt === 'READY') {
    ready = true;
    log('connected to Discord as application ' + config.clientId);
    tick(); // push the current state right away
  } else if (op === 1 && msg && msg.evt === 'ERROR') {
    log('Discord error: ' + payload);
  } else if (op === 3) { // PING -> PONG
    s.write(frame(4, msg || {}));
  } else if (op === 2) { // CLOSE
    log('Discord closed the connection: ' + payload);
    s.end();
  }
}

function setActivity(activity) {
  if (!sock || !ready) return;
  var key = JSON.stringify(activity);
  if (key === lastSent) return; // only push real changes (Discord rate-limits)
  lastSent = key;
  nonce++;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity }, nonce: String(nonce) }));
}

function activityFrom(state) {
  var a = { details: state.details || 'Working in After Effects' };
  if (state.state) a.state = state.state;
  if (state.startTimestamp > 0) a.timestamps = { start: state.startTimestamp };
  if (config.largeImageKey) {
    a.assets = { large_image: config.largeImageKey };
    if (config.largeImageText) a.assets.large_text = config.largeImageText;
  }
  return a;
}

function shutdown(reason) {
  log('exiting: ' + reason);
  try { setActivity(null); } catch (e) {}
  try { fs.unlinkSync(PID_FILE); } catch (e2) {}
  setTimeout(function () { process.exit(0); }, 500); // let the clear frame flush
}

function tick() {
  var state = readJSON(STATE_FILE);
  if (!state) return;
  if (state.stop) { shutdown('panel pressed Stop'); return; }
  var age = Date.now() / 1000 - (state.updatedAt || 0);
  if (age > STALE_SECS) { shutdown('no heartbeat from After Effects for ' + Math.round(age) + 's'); return; }
  setActivity(activityFrom(state));
}

process.on('SIGINT', function () { shutdown('SIGINT'); });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });

log('helper started (pid ' + process.pid + ', node ' + process.version + ')');
connect(ipcCandidates(), 0);
setInterval(tick, 5000);
