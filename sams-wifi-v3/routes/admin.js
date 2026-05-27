// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

let db = null;

// Lazy load database functions
function getDb() {
  if (!db) {
    db = require('../db/database');
  }
  return db;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  try {
    if (req.session.isAdmin) return res.redirect('/admin');
    res.render('admin/login', { title: 'Admin Login', error: null });
  } catch(e) {
    console.error('[Admin/Login GET]', e.message);
    res.status(500).render('error', { title: 'Error', message: 'Login page error' });
  }
});

// ─── LOGIN SUBMIT ─────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

    const { getAdmin, checkRateLimit } = getDb();

    // Rate limit
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
    console.error('[Admin/Login POST]', e.message);
    res.render('admin/login', {
      title: 'Admin Login',
      error: 'Login error. Try again.'
    });
  }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    
    const { getActiveUsers, getSalesStats, getLoadRecommendation, getVoucherCounts, getUnusedCounts, getSleepMode, query } = getDb();

    const activeUsers = getActiveUsers();
    const sales = getSalesStats();
    const loadRec = getLoadRecommendation();
    const voucherCounts = getVoucherCounts();
    const unusedCounts = getUnusedCounts();
    const sleepMode = getSleepMode();

    // Get non-payers
    let nonPayers = [];
    try {
      nonPayers = query(`
        SELECT mac, connected_at, 
               CAST((strftime('%s','now') - connected_at/1000) / 60 AS INTEGER) as minutes_connected
        FROM connections 
        WHERE has_voucher=0 
        AND connected_at > (strftime('%s','now') - 3600) * 1000
        ORDER BY connected_at DESC
        LIMIT 20
      `);
    } catch(e) {
      console.warn('[Dashboard] Non-payers query failed:', e.message);
      nonPayers = [];
    }

    res.render('admin/dashboard', {
      title: 'Dashboard',
      adminUser: req.session.adminUser,
      activeUsers,
      sales,
      loadRec,
      voucherCounts,
      unusedCounts,
      sleepMode,
      nonPayers
    });
  } catch(e) {
    console.error('[Admin/Dashboard]', e.message);
    res.status(500).render('error', { title: 'Error', message: 'Dashboard error' });
  }
});

// ─── SLEEP MODE TOGGLE ────────────────────────────────────────────────────────
router.post('/sleep-mode', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const { setSleepMode } = getDb();
    const enabled = req.body.enabled === 'true';
    setSleepMode(enabled);
    res.json({ success: true });
  } catch(e) {
    console.error('[Admin/Sleep Mode]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
router.post('/change-password', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const { current, newpass, confirm } = req.body;
    const { getAdmin, updateAdminPassword } = getDb();
    
    const admin = getAdmin(req.session.adminUser);
    
    if (!bcrypt.compareSync(current, admin.password_hash)) {
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
    console.error('[Admin/Change Password]', e.message);
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
    
    const vouchers = getAllVouchers({ status, page });
    const counts = getVoucherCounts();
    
    res.render('admin/vouchers', {
      title: 'Vouchers',
      adminUser: req.session.adminUser,
      vouchers,
      counts,
      currentStatus: status,
      currentPage: page
    });
  } catch(e) {
    console.error('[Admin/Vouchers]', e.message);
    res.status(500).render('error', { title: 'Error', message: 'Vouchers page error' });
  }
});

// ─── GENERATE VOUCHERS ────────────────────────────────────────────────────────
router.post('/vouchers/generate', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
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
    console.error('[Admin/Generate]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  try {
    req.session.destroy();
    res.redirect('/admin/login');
  } catch(e) {
    console.error('[Admin/Logout]', e.message);
    res.redirect('/');
  }
});

module.exports = router;
