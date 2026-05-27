// routes/api.js — add these endpoints
const express = require('express');
const router = express.Router();
const { getUnreadNotifications, markNotificationRead, getConnectionTime, markVoucherPaid, trackConnection, queryOne } = require('../db/database');

// ─── Notifications ───────────────────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const notifs = getUnreadNotifications();
  res.json(notifs);
});

router.post('/notifications/:id/read', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  markNotificationRead(req.params.id);
  res.json({ success: true });
});

// ─── Gateway Check (Voucher Validation) ──────────────────────────────────────
router.get('/gateway/check', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('block');
  
  const active = queryOne(
    `SELECT v.code FROM vouchers v 
     WHERE v.status='active' 
     AND v.expires_at > ? 
     AND v.device_id LIKE ?`,
    [Date.now(), '%' + mac.replace(/:/g, '').toLowerCase() + '%']
  );
  res.send(active ? 'allow' : 'block');
});

// ─── Free Trial Tracking ─────────────────────────────────────────────────────
router.get('/gateway/track', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('error');
  
  trackConnection(mac);
  res.send('tracked');
});

router.get('/gateway/trial-time', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('0');
  
  const mins = getConnectionTime(mac);
  res.send(String(mins));
});

router.post('/gateway/mark-paid', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.json({ error: 'no mac' });
  
  markVoucherPaid(mac);
  res.json({ success: true });
});

// ─── Admin Active Users ──────────────────────────────────────────────────────
router.get('/admin/active-users', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const { getActiveUsers } = require('../db/database');
  res.json(getActiveUsers());
});

module.exports = router;
