// routes/admin.js — dashboard route only
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getAdmin, updateAdminPassword, getActiveUsers, getSalesStats, getLoadRecommendation, getVoucherCounts, getUnusedCounts, getSleepMode, setSleepMode, query } = require('../db/database');

// ─── Dashboard ───────────────────────────────────────────────────────────────
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

// ─── Sleep Mode Toggle ───────────────────────────────────────────────────────
router.post('/sleep-mode', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const enabled = req.body.enabled === 'true';
  setSleepMode(enabled);
  res.json({ success: true });
});

// ─── Change Password ─────────────────────────────────────────────────────────
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

// ─── Logout ──────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
