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

// routes/admin.js - FIXED VERSION with non-payers tracking

// Replace the dashboard GET route (around line 30-60) with this:

router.get('/', (req, res) => {
  try {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    const { getActiveUsers, getSalesStats, getLoadRecommendation, getVoucherCounts, getUnusedCounts, getSleepMode, query } = getDb();

    let activeUsers = [], sales = { todaySales:{total:0,count:0}, weekSales:{total:0,count:0}, totalSales:{total:0,count:0}, byPlan:[] };
    let loadRec = { activeUsers:0, unusedVouchers:0, recommendation:{load:50,period:'1 day',users:'0-5',class:'low'} };
    let voucherCounts = { all:0, unused:0, active:0, expired:0, refunded:0 };
    let unusedCounts = { '5min':0, '15min':0, '30min':0, '1hr':0, '3hr':0 };
    let sleepMode = false;
    let nonPayers = [];  // ← ADD THIS

    try { activeUsers = getActiveUsers() || []; } catch(e) {}
    try { sales = getSalesStats() || sales; } catch(e) {}
    try { loadRec = getLoadRecommendation() || loadRec; } catch(e) {}
    try { voucherCounts = getVoucherCounts() || voucherCounts; } catch(e) {}
    try { unusedCounts = getUnusedCounts() || unusedCounts; } catch(e) {}
    try { sleepMode = getSleepMode() || false; } catch(e) {}
    
    // ← ADD THIS BLOCK: Fetch non-payers (free trial users without vouchers)
   try {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
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
} catch(e) {
  console.warn('[Dashboard] Non-payers query error:', e.message);
  nonPayers = [];
}

    res.render('admin/dashboard', {
      title: 'Dashboard',
      adminUser: req.session.adminUser || 'admin',
      activeUsers, 
      sales, 
      loadRec, 
      voucherCounts, 
      unusedCounts, 
      sleepMode,
      nonPayers  // ← ADD THIS to template data
    });
  } catch(e) {
    console.error('[Admin Dashboard Error]', e);
    res.status(500).send(`<h1>Dashboard Error</h1><p>${e.message}</p><a href="/admin/login">Back to Login</a>`);
  }
});
