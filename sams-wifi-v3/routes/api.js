// routes/api.js
const express = require('express');
const router = express.Router();
const {
  getUnreadNotifications, markNotificationRead,
  getConnectionTime, markVoucherPaid, trackConnection,
  queryOne, query, run, getActiveUsers, getLoadRecommendation,
  refundVoucher, getRefundHistory, createBackup, getBackups,
  buildDeviceId
} = require('../db/database');

// ─── GATEWAY: Main enforcement endpoint (router calls this every 30s) ─────────
router.get('/gateway/check', (req, res) => {
  try {
    const rawMac = req.query.mac;
    if (!rawMac) return res.send('block');

    // Normalize MAC to lowercase with colons — router sends aa:bb:cc:dd:ee:ff
    const mac = rawMac.toLowerCase().replace(/[^0-9a-f]/g, '').replace(/(.{2})(?=.)/g, '$1:');
    if (mac.length !== 17) return res.send('block');

    // 1. Check if manually blocked by admin
    const connRecord = queryOne(`SELECT blocked, connected_at, has_voucher FROM connections WHERE mac=?`, [mac]);
    if (connRecord && connRecord.blocked === 1) {
      console.log(`[Gateway] ${mac} - MANUALLY BLOCKED`);
      return res.send('block');
    }

    // 2. Track this connection (always — this is what makes the dashboard work)
    trackConnection(mac);

    // 3. Check if has valid active voucher
    const macNoColon = mac.replace(/:/g, '');
    const validVoucher = queryOne(`
      SELECT code FROM vouchers
      WHERE status='active' AND expires_at > ?
      AND (device_id LIKE ? OR device_id LIKE ?)
      LIMIT 1
    `, [Date.now(), '%' + mac + '%', '%' + macNoColon + '%']);

    if (validVoucher) {
      run(`UPDATE connections SET has_voucher=1 WHERE mac=?`, [mac]);
      console.log(`[Gateway] ${mac} - PAID (${validVoucher.code})`);
      return res.send('allow');
    }

    // 4. Free trial: allow for first 5 minutes
    const minutesConnected = connRecord
      ? Math.floor((Date.now() - connRecord.connected_at) / 60000)
      : 0;

    if (minutesConnected < 5) {
      console.log(`[Gateway] ${mac} - FREE TRIAL (${minutesConnected}m/5m)`);
      return res.send('allow');
    }

    console.log(`[Gateway] ${mac} - TRIAL EXPIRED (${minutesConnected}m)`);
    return res.send('block');

  } catch(e) {
    console.error('[Gateway Error]', e);
    res.send('allow'); // fail open so paying customers are never accidentally blocked
  }
});

// ─── GATEWAY: Trial time remaining ────────────────────────────────────────────
router.get('/gateway/trial-time', (req, res) => {
  try {
    const mac = req.query.mac?.toLowerCase();
    if (!mac) return res.send('0');
    const mins = getConnectionTime(mac);
    res.send(String(mins));
  } catch(e) { res.send('0'); }
});

// ─── GATEWAY: Mark device as paid ─────────────────────────────────────────────
router.post('/gateway/mark-paid', (req, res) => {
  try {
    const mac = req.query.mac?.toLowerCase();
    if (!mac) return res.json({ error: 'no mac' });
    markVoucherPaid(mac);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

// ─── GATEWAY: Block/unblock device (admin action) ─────────────────────────────
router.post('/admin/block-device', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const mac = req.body.mac?.toLowerCase();
    if (!mac) return res.json({ error: 'no mac' });
    trackConnection(mac);
    run(`UPDATE connections SET blocked=1 WHERE mac=?`, [mac]);
    console.log(`[Admin] Blocked device: ${mac}`);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

router.post('/admin/unblock-device', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const mac = req.body.mac?.toLowerCase();
    if (!mac) return res.json({ error: 'no mac' });
    run(`UPDATE connections SET blocked=0 WHERE mac=?`, [mac]);
    console.log(`[Admin] Unblocked device: ${mac}`);
    res.json({ success: true });
  } catch(e) { res.json({ error: e.message }); }
});

router.get('/admin/blocked-devices', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const devices = query(`SELECT mac, connected_at FROM connections WHERE blocked=1 ORDER BY connected_at DESC`);
    res.json(devices);
  } catch(e) { res.json([]); }
});

// ─── Session status (polled every 15s by portal) ──────────────────────────────
router.get('/session-status', (req, res) => {
  if (!req.session.voucher) return res.json({ status: 'no_session' });
  const v = req.session.voucher;
  const now = Date.now();

  const currentDevice = buildDeviceId(req);
  if (currentDevice !== v.device_id) {
    req.session.destroy();
    return res.json({ status: 'device_mismatch' });
  }

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

  res.json({ status: 'active', msRemaining, code: v.code, plan: v.plan, expires_at: dbVoucher.expires_at });
});

// ─── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(getUnreadNotifications()); } catch(e) { res.json([]); }
});

router.post('/notifications/:id/read', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { markNotificationRead(req.params.id); res.json({ success: true }); } catch(e) { res.json({ success: false }); }
});

// ─── Admin data endpoints ─────────────────────────────────────────────────────
router.get('/admin/active-users', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(getActiveUsers()); } catch(e) { res.json([]); }
});

router.post('/admin/refund', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = refundVoucher(req.body.code);
    res.json(result.success ? { success: true, refunded_amount: result.refunded_amount } : { success: false, error: result.error });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

router.get('/admin/refunds', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(getRefundHistory()); } catch(e) { res.json([]); }
});

router.get('/admin/backups', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(getBackups()); } catch(e) { res.json([]); }
});

router.post('/admin/backup', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(createBackup()); } catch(e) { res.json({ success: false, error: e.message }); }
});

module.exports = router;
