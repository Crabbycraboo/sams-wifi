// routes/api.js
const express = require('express');
const router = express.Router();
const {
  getUnreadNotifications, markNotificationRead,
  getConnectionTime, markVoucherPaid, trackConnection,
  queryOne, getActiveUsers, refundVoucher, getRefundHistory,
  createBackup, getBackups
} = require('../db/database');
// Add these routes to routes/api.js

// ─── BLOCK/UNBLOCK DEVICE (Admin Only) ──────────────────────────────────────

router.post('/admin/block-device', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { mac } = req.body;
    if (!mac || !mac.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)) {
      return res.status(400).json({ error: 'Invalid MAC address' });
    }
    
    // Add to blocked list (create table if needed)
    const { run, queryOne } = require('../db/database');
    
    const exists = queryOne(`SELECT id FROM connections WHERE mac=? AND blocked=1`, [mac]);
    if (exists) {
      return res.json({ success: true, message: 'Already blocked' });
    }
    
    run(`UPDATE connections SET blocked=1 WHERE mac=?`, [mac]);
    res.json({ success: true, message: `Blocked: ${mac}` });
  } catch(e) {
    console.error('[Block Device]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/unblock-device', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ error: 'Invalid MAC' });
    
    const { run } = require('../db/database');
    run(`UPDATE connections SET blocked=0 WHERE mac=?`, [mac]);
    res.json({ success: true, message: `Unblocked: ${mac}` });
  } catch(e) {
    console.error('[Unblock Device]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── GATEWAY CHECK (Modified to check blocked status) ──────────────────────

router.get('/gateway/check', (req, res) => {
  try {
    const mac = req.query.mac?.toUpperCase();
    if (!mac) return res.send('block');

    const { queryOne } = require('../db/database');

    // Check if manually blocked
    const blocked = queryOne(`SELECT blocked FROM connections WHERE mac=?`, [mac]);
    if (blocked && blocked.blocked === 1) {
      return res.send('block');
    }

    // Check if has valid voucher
    const voucher = queryOne(`
      SELECT * FROM vouchers 
      WHERE status='active' 
      AND expires_at > ? 
      AND device_id LIKE ?
    `, [Date.now(), '%' + mac.substring(mac.length - 8) + '%']);

    if (voucher && voucher.expires_at > Date.now()) {
      return res.send('allow');
    }

    res.send('block');
  } catch(e) {
    console.error('[Gateway Check]', e);
    res.send('block');
  }
});

// ─── GET BLOCKED DEVICES (for dashboard) ────────────────────────────────────

router.get('/admin/blocked-devices', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { query } = require('../db/database');
    const blocked = query(`SELECT mac, connected_at, blocked FROM connections WHERE blocked=1 ORDER BY connected_at DESC LIMIT 50`);
    res.json({ success: true, blocked });
  } catch(e) {
    console.error('[Blocked Devices]', e);
    res.status(500).json({ error: e.message });
  }
});
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
