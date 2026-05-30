// db/database.js — with repeater detection
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sams_wifi.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

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
    wifi_password TEXT,
    refunded INTEGER DEFAULT 0
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

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT NOT NULL UNIQUE,
    connected_at INTEGER NOT NULL,
    has_voucher INTEGER DEFAULT 0,
    blocked INTEGER DEFAULT 0
  )`);

  // Separate table to count reconnection events (for repeater detection)
  db.run(`CREATE TABLE IF NOT EXISTS connection_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT NOT NULL,
    event_at INTEGER NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conn_events ON connection_events(mac, event_at)`);

  db.run(`CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    size INTEGER
  )`);

  const adminRows = db.exec(`SELECT id FROM admin_users WHERE username = 'admin'`);
  if (!adminRows.length || !adminRows[0].values.length) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'sams2024', 10);
    db.run(`INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)`,
      ['admin', hash, Date.now()]);
    console.log('[DB] Default admin created. user:admin pass:sams2024 — change immediately!');
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  saveDb();
  console.log(`[DB] Ready at ${DB_PATH}`);
  scheduleAutoBackup();
  scheduleAutoCleanup();
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

function run(sql, par
