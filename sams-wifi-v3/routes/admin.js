// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  PLANS, generateVouchers, getActiveUsers, getSalesStats,
  getLoadRecommendation, getAllVouchers, getAdmin,
  updateAdminPassword, getVoucherCounts, getUnusedCounts,
  getWifiBatches, checkRateLimit, getSleepMode, setSleepMode
} = require('../db/database');

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

  const rateCheck = checkRateLimit(ip + ':admin', 'admin_login');
  if (!rateCheck.allowed) {
    return res.render('admin/login', {
      title: 'Admin Login',
      error: `Too many failed attempts. Try again in ${rateCheck.retryMins} minute(s).`
    });
  }

  const admin = getAdmin(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.render('admin/login', { title: 'Admin Login', error: 'Invalid username or password.' });
  }
  req.session.isAdmin = true;
  req.session.adminUser = admin.username;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

router.get('/', requireAdmin, (req, res) => {
  const activeUsers  = getActiveUsers();
  const sales        = getSalesStats();
  const loadRec      = getLoadRecommendation();
  const unusedCounts = getUnusedCounts();
  const wifiBatches  = getWifiBatches();
  const sleepMode    = getSleepMode();

  res.render('admin/dashboard', {
    title: "Admin – Sam's WiFi",
    adminUser: req.session.adminUser,
    activeUsers, sales, loadRec, unusedCounts, plans: PLANS, wifiBatches, sleepMode
  });
});

// ─── Sleep mode toggle ────────────────────────────────────────────────────────
router.post('/sleep-mode', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  setSleepMode(enabled === 'true');
  res.json({ success: true, sleepMode: getSleepMode() });
});

router.get('/vouchers', requireAdmin, (req, res) => {
  const { status, page = 1 } = req.query;
  const vouchers = getAllVouchers({ status, page: parseInt(page) });
  const counts   = getVoucherCounts();
  res.render('admin/vouchers', {
    title: 'Vouchers – Admin',
    vouchers, counts,
    currentStatus: status || 'all',
    currentPage: parseInt(page),
    plans: PLANS
  });
});

router.post('/vouchers/generate', requireAdmin, (req, res) => {
  const { plan, count, use_wifi_password } = req.body;
  const qty = Math.min(Math.max(parseInt(count) || 20, 1), 100);
  const batchId = uuidv4().substring(0, 8).toUpperCase();
  const useWifi = use_wifi_password === 'on' || use_wifi_password === 'true';

  try {
    const result = generateVouchers(plan, qty, batchId, useWifi);
    res.json({
      success: true,
      codes: result.codes,
      batchId,
      count: result.codes.length,
      wifiPassword: result.wifiPassword
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { current, newpass, confirm } = req.body;
  const admin = getAdmin(req.session.adminUser);
  if (!bcrypt.compareSync(current, admin.password_hash))
    return res.json({ success: false, error: 'Current password is wrong.' });
  if (newpass !== confirm)
    return res.json({ success: false, error: 'New passwords do not match.' });
  if (newpass.length < 6)
    return res.json({ success: false, error: 'Password must be at least 6 characters.' });
  const hash = bcrypt.hashSync(newpass, 10);
  updateAdminPassword(req.session.adminUser, hash);
  res.json({ success: true });
});

module.exports = router;
