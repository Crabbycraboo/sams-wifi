// routes/api.js
const express = require('express');
const router = express.Router();
const {
  getUnreadNotifications, markNotificationRead,
  getConnectionTime, markVoucherPaid, trackConnection,
  queryOne, getActiveUsers, refundVoucher, getRefundHistory,
  createBackup, getBackups
} = require('../db/database');

// ─── Session status (polled every 15s by portal) ──────────────────────────────
router.get('/session-status', (req, res) => {
  if (!req.session.voucher) return res.json({ status: 'no_session' });
  const v = req.session.voucher;
  const now = Date.now();
  // Verify device fingerprint
  const { buildDeviceId } = require('../db/database');
  const currentDevice = buildDeviceId(req);
  if (currentDevice !== v.device_id) {
    req.session.destroy();
    return res.json({ status: 'device_mismatch' });
  }
  // Verify DB
  const dbVoucher = queryOne('SELECT status, expires_at FROM vouchers WHERE code = ?', [v.code]);
  if (!dbVoucher || dbVoucher.status === 'expired') {
    req.session.destroy();
    return res.json({ status: 'expired' });
  }
  const msRemaining = dbVoucher.expires_at - now;
  if (msRemaining <= 0) {
    req.session.destroy();
    return res.json({ status: 'expired' });
  }
  res.json({
    status: 'active',
    msRemaining,
    code: v.code,
    plan: v.plan,
    expires_at: dbVoucher.expires_at
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getUnreadNotifications());
});

router.post('/notifications/:id/read', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  markNotificationRead(req.params.id);
  res.json({ success: true });
});

// ─── Gateway enforcement ──────────────────────────────────────────────────────
router.get('/gateway/check', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('block');
  const active = queryOne(
    `SELECT v.code FROM vouchers v WHERE v.status='active' AND v.expires_at > ? AND v.device_id LIKE ?`,
    [Date.now(), '%' + mac.replace(/:/g, '').toLowerCase() + '%']
  );
  res.send(active ? 'allow' : 'block');
});

router.get('/gateway/track', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('error');
  trackConnection(mac);
  res.send('tracked');
});

router.get('/gateway/trial-time', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.send('0');
  res.send(String(getConnectionTime(mac)));
});

router.post('/gateway/mark-paid', (req, res) => {
  const mac = req.query.mac;
  if (!mac) return res.json({ error: 'no mac' });
  markVoucherPaid(mac);
  res.json({ success: true });
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────
router.get('/admin/active-users', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getActiveUsers());
});

router.post('/admin/refund', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const result = refundVoucher(req.body.code);
  res.json(result.success ? { success: true, refunded_amount: result.refunded_amount } : { success: false, error: result.error });
});

router.get('/admin/refunds', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getRefundHistory());
});

router.get('/admin/backups', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getBackups());
});

router.post('/admin/backup', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(createBackup());
});

module.exports = router;
