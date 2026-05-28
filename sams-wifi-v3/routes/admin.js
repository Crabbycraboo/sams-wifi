// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

let db = null;
function getDb() {
  if (!db) db = require('../db/database');
  return db;
}

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
      return res.render('admin/login', { title: 'Admin Login', error: `Too many attempts. Wait ${rateCheck.retryMins} min(s).` });
    }

    const admin = getAdmin(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.render('admin/login', { title: 'Admin Login', error: 'Invalid username or password.' });
    }

    req.session.isAdmin = true;
    req.session.adminUser = username;
    res.redirect('/admin');
  } catch(e) {
    console.error('[Admin Login POST]', e);
    res.render('admin/login', { title: 'Admin Login', error: 'Login error' });
  }
});

router.get('/', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    const { getActiveUsers, getSalesStats, getLoadRecommendation, getVoucherCounts, getUnusedCounts, getSleepMode, query } = getDb();

    let activeUsers = [], sales = { todaySales:{total:0,count:0}, weekSales:{total:0,count:0}, totalSales:{total:0,count:0}, byPlan:[] };
    let loadRec = { activeUsers:0, unusedVouchers:0, recommendation:{load:50,period:'1 day',users:'0-5',class:'low'} };
    let voucherCounts = { all:0, unused:0, active:0, expired:0, refunded:0 };
    let unusedCounts = { '5min':0, '15min':0, '30min':0, '1hr':0, '3hr':0 };
    let sleepMode = false;

    try { activeUsers = getActiveUsers() || []; } catch(e) {}
    try { sales = getSalesStats() || sales; } catch(e) {}
    try { loadRec = getLoadRecommendation() || loadRec; } catch(e) {}
    try { voucherCounts = getVoucherCounts() || voucherCounts; } catch(e) {}
    try { unusedCounts = getUnusedCounts() || unusedCounts; } catch(e) {}
    try { sleepMode = getSleepMode() || false; } catch(e) {}

    res.render('admin/dashboard', {
      title: 'Dashboard',
      adminUser: req.session.adminUser || 'admin',
      activeUsers, sales, loadRec, voucherCounts, unusedCounts, sleepMode
    });
  } catch(e) {
    console.error('[Admin Dashboard Error]', e);
    res.status(500).send(`<h1>Dashboard Error</h1><p>${e.message}</p><a href="/admin/login">Back to Login</a>`);
  }
});

router.post('/sleep-mode', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    getDb().setSleepMode(req.body.enabled === 'true');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/change-password', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { current, newpass, confirm } = req.body;
    const { getAdmin, updateAdminPassword } = getDb();
    const admin = getAdmin(req.session.adminUser);
    if (!admin || !bcrypt.compareSync(current, admin.password_hash)) return res.json({ success: false, error: 'Current password incorrect' });
    if (newpass.length < 6) return res.json({ success: false, error: 'Min 6 characters' });
    if (newpass !== confirm) return res.json({ success: false, error: 'Passwords do not match' });
    updateAdminPassword(req.session.adminUser, bcrypt.hashSync(newpass, 10));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/vouchers', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    const { getAllVouchers, getVoucherCounts } = getDb();
    const status = req.query.status || 'all';
    const page = parseInt(req.query.page) || 1;
    res.render('admin/vouchers', {
      title: 'Vouchers',
      adminUser: req.session.adminUser,
      vouchers: getAllVouchers({ status, page }) || [],
      counts: getVoucherCounts() || { all:0, unused:0, active:0, expired:0, refunded:0 },
      currentStatus: status,
      currentPage: page
    });
  } catch(e) {
    res.status(500).send(`<h1>Vouchers Error</h1><p>${e.message}</p><a href="/admin">Back to Dashboard</a>`);
  }
});

router.post('/vouchers/generate', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { plan, count, use_wifi_password } = req.body;
    const { generateVouchers } = getDb();
    const batchId = `batch-${Date.now()}`;
    const useWifi = use_wifi_password === 'true';
    const result = generateVouchers(plan, parseInt(count), batchId, useWifi);
    res.json({ success: true, codes: result.codes, count: result.codes.length, batchId, wifiPassword: result.wifiPassword });
  } catch(e) {
    console.error('[Generate Vouchers]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
