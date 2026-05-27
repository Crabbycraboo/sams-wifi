// db/database.js — hardened version with rate limiting + wifi password batches
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sams_wifi.db');

let SQL, db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL,
    price INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused',
    device_id TEXT,
    started_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    batch_id TEXT,
    wifi_password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    device_id TEXT,
    plan TEXT NOT NULL,
    price INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    action TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_rate_limits ON rate_limits(identifier, action, attempted_at)`);

  db.run(`CREATE TABLE IF NOT EXISTS wifi_batches (
    batch_id TEXT PRIMARY KEY,
    wifi_password TEXT NOT NULL,
    plan TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  const adminRows = db.exec(`SELECT id FROM admin_users WHERE username = 'admin'`);
  if (!adminRows.length || !adminRows[0].values.length) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'sams2024', 10);
    db.run(`INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)`,
      ['admin', hash, Date.now()]);
    console.log('[DB] Default admin created. user:admin pass:sams2024 — change immediately!');
  }

  saveDb();
  console.log(`[DB] Ready at ${DB_PATH}`);
}

function query(sql, params = []) {
  const results = db.exec(sql, params);
  if (!results.length) return [];
  const { columns, values } = results[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ─── PLANS — Consistent ₱0.40/minute ────────────────────────────────────────
const PLANS = [
  { id: 1, name: '₱2 / 5 min',   price: 2,  duration_ms: 5 * 60 * 1000 },
  { id: 2, name: '₱5 / 15 min',  price: 5,  duration_ms: 15 * 60 * 1000 },
  { id: 3, name: '₱10 / 30 min', price: 10, duration_ms: 30 * 60 * 1000 },
  { id: 4, name: '₱20 / 60 min', price: 20, duration_ms: 60 * 60 * 1000 },
  { id: 5, name: '₱60 / 3 hrs',  price: 60, duration_ms: 3 * 60 * 60 * 1000 }
];

// ─── Rate limiting ───────────────────────────────────────────────────────────
const RATE_LIMITS = {
  code_attempt: { windowMs: 5 * 60 * 1000, maxAttempts: 10 },
  admin_login:  { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
};

function checkRateLimit(identifier, action) {
  const limit = RATE_LIMITS[action];
  if (!limit) return { allowed: true };

  const windowStart = Date.now() - limit.windowMs;
  const attempts = queryOne(
    `SELECT COUNT(*) as c FROM rate_limits WHERE identifier=? AND action=? AND attempted_at > ?`,
    [identifier, action, windowStart]
  );
  const count = attempts ? attempts.c : 0;

  if (count >= limit.maxAttempts) {
    const oldest = queryOne(
      `SELECT MIN(attempted_at) as t FROM rate_limits WHERE identifier=? AND action=? AND attempted_at > ?`,
      [identifier, action, windowStart]
    );
    const retryAfterMs = oldest ? (oldest.t + limit.windowMs - Date.now()) : limit.windowMs;
    const retryMins = Math.ceil(retryAfterMs / 60000);
    return { allowed: false, retryMins };
  }

  db.run(`INSERT INTO rate_limits (identifier, action, attempted_at) VALUES (?, ?, ?)`,
    [identifier, action, Date.now()]);
  saveDb();
  return { allowed: true, attemptsLeft: limit.maxAttempts - count - 1 };
}

function pruneRateLimits() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  db.run(`DELETE FROM rate_limits WHERE attempted_at < ?`, [cutoff]);
  saveDb();
}

// ─── Device fingerprinting ───────────────────────────────────────────────────
function buildDeviceId(req) {
  const ip   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua   = req.headers['user-agent'] || 'unknown';
  const lang = req.headers['accept-language']?.split(',')[0] || 'unknown';
  const raw  = ip + '|' + ua + '|' + lang;
  let hash = 5381;
  for (const c of raw) hash = ((hash << 5) + hash + c.charCodeAt(0)) | 0;
  return 'dev_' + Math.abs(hash).toString(36);
}

// ─── WiFi password generation ────────────────────────────────────────────────
function generateWifiPassword() {
  const words = ['mango','taho','halo','puto','sago','buko','mais','tuyo','tinapay','kape'];
  const nums  = Math.floor(100 + Math.random() * 900);
  const word  = words[Math.floor(Math.random() * words.length)];
  return word + nums;
}

// ─── Voucher generation ──────────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SAM-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateVouchers(plan, count, batchId, useWifiPassword = false) {
  const planInfo = PLANS.find(p => p.id === parseInt(plan));
  if (!planInfo) throw new Error('Invalid plan: ' + plan);

  const wifiPassword = useWifiPassword ? generateWifiPassword() : null;

  if (useWifiPassword) {
    db.run(`INSERT OR REPLACE INTO wifi_batches (batch_id, wifi_password, plan, created_at, active) VALUES (?, ?, ?, ?, 1)`,
      [batchId, wifiPassword, plan, Date.now()]);
  }

  const generated = [];
  let attempts = 0;
  while (generated.length < count && attempts < count * 10) {
    attempts++;
    const code = generateCode();
    if (!queryOne(`SELECT id FROM vouchers WHERE code = ?`, [code])) {
      run(`INSERT INTO vouchers (code, plan, price, duration_ms, batch_id, wifi_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, plan, planInfo.price, planInfo.duration_ms, batchId, wifiPassword, Date.now()]);
      generated.push(code);
    }
  }
  return { codes: generated, wifiPassword };
}

// ─── Redemption ──────────────────────────────────────────────────────────────
function redeemVoucher(code, deviceId) {
  const voucher = queryOne(`SELECT * FROM vouchers WHERE code = ?`, [code.toUpperCase().trim()]);
  if (!voucher) return { success: false, message: 'Code not found. Check your voucher and try again.' };
  if (voucher.status === 'expired') return { success: false, message: 'This voucher has already been used.' };
  if (voucher.status === 'active') {
    if (voucher.device_id === deviceId) return { success: true, voucher };
    return { success: false, message: 'This voucher is already being used on another device.' };
  }
  const now = Date.now();
  const expiresAt = now + voucher.duration_ms;
  run(`UPDATE vouchers SET status='active', device_id=?, started_at=?, expires_at=? WHERE id=?`,
    [deviceId, now, expiresAt, voucher.id]);
  run(`INSERT INTO sessions_log (voucher_id, code, device_id, plan, price, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [voucher.id, voucher.code, deviceId, voucher.plan, voucher.price, now]);
  return { success: true, voucher: { ...voucher, status: 'active', started_at: now, expires_at: expiresAt, device_id: deviceId } };
}

function expireVoucher(voucherId) {
  const now = Date.now();
  run(`UPDATE vouchers SET status='expired' WHERE id=?`, [voucherId]);
  run(`UPDATE sessions_log SET ended_at=? WHERE voucher_id=? AND ended_at IS NULL`, [now, voucherId]);
}

function checkExpiredVouchers() {
  const now = Date.now();
  const expired = query(`SELECT id FROM vouchers WHERE status='active' AND expires_at <= ?`, [now]);
  expired.forEach(v => expireVoucher(v.id));
  return expired.length;
}

// ─── Admin queries ───────────────────────────────────────────────────────────
function getActiveUsers() {
  const now = Date.now();
  return query(`SELECT code, plan, price, device_id, started_at, expires_at, (expires_at - ?) as ms_remaining
    FROM vouchers WHERE status='active' ORDER BY expires_at ASC`, [now]);
}

function getSalesStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const weekMs  = todayMs - 6 * 24 * 60 * 60 * 1000;

  const totalSales = queryOne(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM sessions_log`) || { total: 0, count: 0 };
  const todaySales = queryOne(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM sessions_log WHERE started_at >= ?`, [todayMs]) || { total: 0, count: 0 };
  const weekSales  = queryOne(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM sessions_log WHERE started_at >= ?`, [weekMs]) || { total: 0, count: 0 };
  const byPlan = query(`SELECT plan, COUNT(*) as count, SUM(price) as revenue FROM sessions_log GROUP BY plan ORDER BY revenue DESC`);
  const dailyBreakdown = query(`
    SELECT date(started_at/1000, 'unixepoch', 'localtime') as day, SUM(price) as revenue, COUNT(*) as sessions
    FROM sessions_log WHERE started_at >= ? GROUP BY day ORDER BY day ASC`, [weekMs]);

  return { totalSales, todaySales, weekSales, byPlan, dailyBreakdown };
}

function getLoadRecommendation() {
  const active = getActiveUsers().length;
  const row = queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused'`);
  const unusedCount = row ? row.c : 0;
  let recommendation;
  if (active <= 5)       recommendation = { load: 50,  period: 'isang araw (1 day)',   users: '0–5 users',  class: 'low' };
  else if (active <= 15) recommendation = { load: 85,  period: '2 araw (2 days)',       users: '5–15 users', class: 'medium' };
  else                   recommendation = { load: 200, period: '5 araw (5 days)',       users: '15+ users',  class: 'high' };
  return { activeUsers: active, unusedVouchers: unusedCount, recommendation };
}

function getAllVouchers({ status, page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  if (status && status !== 'all') {
    return query(`SELECT * FROM vouchers WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?`, [status, limit, offset]);
  }
  return query(`SELECT * FROM vouchers ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

function getAdmin(username) { return queryOne(`SELECT * FROM admin_users WHERE username=?`, [username]); }
function updateAdminPassword(username, newHash) {
  run(`UPDATE admin_users SET password_hash=? WHERE username=?`, [newHash, username]);
}

function getVoucherCounts() {
  return {
    all:     (queryOne(`SELECT COUNT(*) as c FROM vouchers`) || {c:0}).c,
    unused:  (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused'`) || {c:0}).c,
    active:  (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='active'`) || {c:0}).c,
    expired: (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='expired'`) || {c:0}).c,
  };
}

function getUnusedCounts() {
  return {
    '5min':  (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused' AND plan='5min'`) || {c:0}).c,
    '15min': (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused' AND plan='15min'`) || {c:0}).c,
    '30min': (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused' AND plan='30min'`) || {c:0}).c,
    '60min': (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused' AND plan='60min'`) || {c:0}).c,
    '3hrs':  (queryOne(`SELECT COUNT(*) as c FROM vouchers WHERE status='unused' AND plan='3hrs'`) || {c:0}).c,
  };
}

function getWifiBatches() {
  return query(`SELECT * FROM wifi_batches ORDER BY created_at DESC LIMIT 10`);
}

// ─── Sleep Mode ──────────────────────────────────────────────────────────────
function setSleepMode(val) {
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('sleep_mode', ?)`, [val ? '1' : '0']);
  saveDb();
}

function getSleepMode() {
  try {
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    const row = queryOne(`SELECT value FROM settings WHERE key='sleep_mode'`);
    return row ? row.value === '1' : false;
  } catch(e) { return false; }
}
// ─── Notifications ───────────────────────────────────────────────────────────
function createNotification(type, message, data = {}) {
  run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  
  run(`INSERT INTO notifications (type, message, data, created_at) VALUES (?, ?, ?, ?)`,
    [type, message, JSON.stringify(data), Date.now()]);
}

function getUnreadNotifications() {
  return query(`SELECT * FROM notifications WHERE read=0 ORDER BY created_at DESC LIMIT 20`);
}

function markNotificationRead(id) {
  run(`UPDATE notifications SET read=1 WHERE id=?`, [id]);
}

function clearOldNotifications() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
  run(`DELETE FROM notifications WHERE created_at < ?`, [cutoff]);
}
// ─── Free Trial Tracking ─────────────────────────────────────────────
function trackConnection(mac) {
  run(`CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    has_voucher INTEGER DEFAULT 0
  )`);
  
  // Check if this MAC already has an active entry
  const existing = queryOne(`SELECT id FROM connections WHERE mac=? AND has_voucher=0`, [mac]);
  if (!existing) {
    run(`INSERT INTO connections (mac, connected_at, has_voucher) VALUES (?, ?, 0)`,
      [mac, Date.now()]);
  }
}

function markVoucherPaid(mac) {
  run(`UPDATE connections SET has_voucher=1 WHERE mac=?`, [mac]);
}

function getConnectionTime(mac) {
  const conn = queryOne(`SELECT connected_at FROM connections WHERE mac=?`, [mac]);
  return conn ? Math.floor((Date.now() - conn.connected_at) / 1000 / 60) : 0; // returns minutes
}

function hasValidVoucher(mac) {
  const conn = queryOne(`SELECT has_voucher FROM connections WHERE mac=?`, [mac]);
  return conn ? conn.has_voucher === 1 : false;
}

function cleanupOldConnections() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  run(`DELETE FROM connections WHERE connected_at < ?`, [cutoff]);
}
module.exports = {
  initDb, PLANS,createNotification, getUnreadNotifications, markNotificationRead, clearOldNotifications,trackConnection, markVoucherPaid, getConnectionTime, hasValidVoucher, cleanupOldConnections,
  generateVouchers, redeemVoucher, expireVoucher, checkExpiredVouchers,
  getActiveUsers, getSalesStats, getLoadRecommendation,
  getAllVouchers, getAdmin, updateAdminPassword, getVoucherCounts, getUnusedCounts,
  getWifiBatches, checkRateLimit, pruneRateLimits, buildDeviceId,
  setSleepMode, getSleepMode,
  queryOne, query, run,
};
