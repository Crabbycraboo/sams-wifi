// routes/admin.js - COMPLETE VERSION showing all features

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

let db = null;

function getDb() {
  if (!db) db = require('../db/database');
  return db;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const { getAdmin, checkRateLimit } = getDb();

    const rateCheck = checkRateLimit(ip, 'admin_login');
    if (!rateCheck.allowed) {
      return res.render('admin/login', {
        title: 'Admin Login',
        error: `Too many attempts. Wait ${rateCheck.retryMins} min(s).`
      });
    }

    const admin = getAdmin(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.render('admin/login', {
        title: 'Admin Login',
        error: 'Invalid username or password.'
      });
    }

    req.session.isAdmin = true;
    req.session.adminUser = username;
    res.redirect('/admin');
  } catch(e) {
    console.error('[Admin Login]', e);
    res.render('admin/login', { title: 'Admin Login', error: 'Login error' });
  }
});

// ─── DASHBOARD (with ALL features) ────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');

    const {
      getActiveUsers, getSalesStats, getLoadRecommendation,
      getVoucherCounts, getUnusedCounts, getSleepMode,
      getBackups, getRefundHistory, getUnreadNotifications,
      getWifiBatches, query
    } = getDb();

    // Initialize all data with safe defaults
    let activeUsers = [];
    let sales = { todaySales:{total:0,count:0}, weekSales:{total:0,count:0}, totalSales:{total:0,count:0}, byPlan:[] };
    let loadRec = { activeUsers:0, unusedVouchers:0, recommendation:{load:50,period:'1 day',users:'0-5',class:'low'} };
    let voucherCounts = { all:0, unused:0, active:0, expired:0, refunded:0 };
    let unusedCounts = { '5min':0, '15min':0, '30min':0, '1hr':0, '3hr':0 };
    let sleepMode = false;
    let nonPayers = [];
    let backups = [];
    let refunds = [];
    let notifications = [];
    let wifiBatches = [];

    // Fetch all data
    try { activeUsers = getActiveUsers() || []; } catch(e) { console.warn('[Dashboard] activeUsers:', e.message); }
    try { sales = getSalesStats() || sales; } catch(e) { console.warn('[Dashboard] sales:', e.message); }
    try { loadRec = getLoadRecommendation() || loadRec; } catch(e) { console.warn('[Dashboard] loadRec:', e.message); }
    try { voucherCounts = getVoucherCounts() || voucherCounts; } catch(e) { console.warn('[Dashboard] voucherCounts:', e.message); }
    try { unusedCounts = getUnusedCounts() || unusedCounts; } catch(e) { console.warn('[Dashboard] unusedCounts:', e.message); }
    try { sleepMode = getSleepMode() || false; } catch(e) { console.warn('[Dashboard] sleepMode:', e.message); }

    // Fetch non-payers (free trial users without vouchers)
  try {
const now = Date.now();
const oneHourAgo = now - 3600000;
const { query } = getDb();  
const allConnections = query(`
        SELECT mac, connected_at, has_voucher
        FROM connections
        WHERE has_voucher = 0
        AND connected_at > ?
        ORDER BY connected_at DESC
        LIMIT 20
      `, [oneHourAgo]) || [];

      nonPayers = allConnections.map(conn => ({
        mac: conn.mac,
        connected_at: conn.connected_at,
        minutes_connected: Math.floor((now - conn.connected_at) / 1000 / 60),
        trial_status: Math.floor((now - conn.connected_at) / 1000 / 60) >= 5 ? 'EXPIRED' : 'ACTIVE'
      }));
    } catch(e) { console.warn('[Dashboard] nonPayers:', e.message); }

    // Fetch backups
    try { backups = getBackups() || []; } catch(e) { console.warn('[Dashboard] backups:', e.message); }

    // Fetch refund history
    try { refunds = getRefundHistory() || []; } catch(e) { console.warn('[Dashboard] refunds:', e.message); }

    // Fetch notifications
    try { notifications = getUnreadNotifications() || []; } catch(e) { console.warn('[Dashboard] notifications:', e.message); }

    // Fetch WiFi batches
    try { wifiBatches = getWifiBatches() || []; } catch(e) { console.warn('[Dashboard] wifiBatches:', e.message); }

    res.render('admin/dashboard', {
      title: 'Dashboard',
      adminUser: req.session.adminUser || 'admin',
      activeUsers,
      sales,
      loadRec,
      voucherCounts,
      unusedCounts,
      sleepMode,
      nonPayers,
      backups,
      refunds,
      notifications,
      wifiBatches
    });
  } catch(e) {
    console.error('[Admin Dashboard Error]', e);
    res.status(500).send(`<h1>Dashboard Error</h1><p>${e.message}</p><a href="/admin/login">Back to Login</a>`);
  }
});

// ─── SLEEP MODE TOGGLE ────────────────────────────────────────────────────────
router.post('/sleep-mode', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { setSleepMode } = getDb();
    setSleepMode(req.body.enabled === 'true');
    res.json({ success: true });
  } catch(e) {
    console.error('[Sleep Mode]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
router.post('/change-password', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { current, newpass, confirm } = req.body;
    const { getAdmin, updateAdminPassword } = getDb();

    const admin = getAdmin(req.session.adminUser);
    if (!admin || !bcrypt.compareSync(current, admin.password_hash)) {
      return res.json({ success: false, error: 'Current password incorrect' });
    }
    if (newpass.length < 6) {
      return res.json({ success: false, error: 'Min 6 characters' });
    }
    if (newpass !== confirm) {
      return res.json({ success: false, error: 'Passwords do not match' });
    }

    const hash = bcrypt.hashSync(newpass, 10);
    updateAdminPassword(req.session.adminUser, hash);
    res.json({ success: true });
  } catch(e) {
    console.error('[Change Password]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── VOUCHERS PAGE ────────────────────────────────────────────────────────────
router.get('/vouchers', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');

    const { getAllVouchers, getVoucherCounts } = getDb();
    const status = req.query.status || 'all';
    const page = parseInt(req.query.page) || 1;

    const vouchers = getAllVouchers({ status, page }) || [];
    const counts = getVoucherCounts() || { all:0, unused:0, active:0, expired:0, refunded:0 };

    res.render('admin/vouchers', {
      title: 'Vouchers',
      adminUser: req.session.adminUser,
      vouchers,
      counts,
      currentStatus: status,
      currentPage: page
    });
  } catch(e) {
    console.error('[Vouchers Page]', e);
    res.status(500).send(`<h1>Vouchers Error</h1><p>${e.message}</p><a href="/admin">Back</a>`);
  }
});

// ─── GENERATE VOUCHERS ────────────────────────────────────────────────────────
router.post('/vouchers/generate', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { plan, count } = req.body;
    const { generateVouchers } = getDb();
    const batchId = `batch-${Date.now()}`;

    const result = generateVouchers(plan, parseInt(count), batchId, false);
    res.json({
      success: true,
      codes: result.codes,
      count: result.codes.length,
      batchId
    });
  } catch(e) {
    console.error('[Generate Vouchers]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  try {
    req.session.destroy();
    res.redirect('/admin/login');
  } catch(e) {
    console.error('[Logout]', e);
    res.redirect('/');
  }
});

module.exports = router;
