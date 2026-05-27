// routes/admin.js — complete admin routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { 
  getAdmin, updateAdminPassword, getActiveUsers, getSalesStats, 
  getLoadRecommendation, getVoucherCounts, getUnusedCounts, getSleepMode, setSleepMode, 
  query, generateVouchers, refundVoucher, getRefundHistory, getBackups
} = require('../db/database');

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null });
});

// ─── LOGIN SUBMIT ─────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

  // Rate limit
  const { checkRateLimit } = require('../db/database');
  const rateCheck = checkRateLimit(ip, 'admin_login');
  if (!rateCheck.allowed) {
    return res.render('admin/login', {
      title: 'Admin Login',
      error: `Too many attempts. Please wait ${rateCheck.retryMins} minute(s).`
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
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  
  const activeUsers = getActiveUsers();
  const sales = getSalesStats();
  const loadRec = getLoadRecommendation();
  const voucherCounts = getVoucherCounts();
  const unusedCounts = getUnusedCounts();
  const sleepMode = getSleepMode();

  // Get non-payers
  const nonPayers = query(`
    SELECT mac, connected_at, 
           CAST((strftime('%s','now') - connected_at/1000) / 60 AS INTEGER) as minutes_connected
    FROM connections 
    WHERE has_voucher=0 
    AND connected_at > (strftime('%s','now') - 3600) * 1000
    ORDER BY connected_at DESC
    LIMIT 20
  `);

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
});

// ─── SLEEP MODE TOGGLE ────────────────────────────────────────────────────────
router.post('/sleep-mode', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const enabled = req.body.enabled === 'true';
  setSleepMode(enabled);
  res.json({ success: true });
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
router.post('/change-password', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  const { current, newpass, confirm } = req.body;
  const admin = getAdmin(req.session.adminUser);
  
  if (!bcrypt.compareSync(current, admin.password_hash)) {
    return res.json({ success: false, error: 'Current password is incorrect' });
  }
  if (newpass.length < 6) {
    return res.json({ success: false, error: 'New password must be at least 6 characters' });
  }
  if (newpass !== confirm) {
    return res.json({ success: false, error: 'Passwords do not match' });
  }
  
  const hash = bcrypt.hashSync(newpass, 10);
  updateAdminPassword(req.session.adminUser, hash);
  res.json({ success: true });
});

// ─── VOUCHERS PAGE ────────────────────────────────────────────────────────────
router.get('/vouchers', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  
  const { getAllVouchers } = require('../db/database');
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
});

// ─── GENERATE VOUCHERS ────────────────────────────────────────────────────────
router.post('/vouchers/generate', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  const { plan, count } = req.body;
  const batchId = `batch-${Date.now()}`;
  
  try {
    const result = generateVouchers(plan, parseInt(count), batchId, false);
    res.json({
      success: true,
      codes: result.codes,
      count: result.codes.length,
      batchId
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
