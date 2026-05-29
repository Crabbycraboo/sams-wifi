// routes/api.js - CLEAN VERSION (NO DUPLICATES)

const express = require('express');
const router = express.Router();
const {
  getUnreadNotifications, markNotificationRead,
  getConnectionTime, markVoucherPaid, trackConnection,
  queryOne, query, run, getActiveUsers, refundVoucher, getRefundHistory,
  createBackup, getBackups, buildDeviceId
} = require('../db/database');

// ─── GATEWAY CHECK (Router calls this to verify device) ──────────────────────
router.get('/gateway/check', (req, res) => {
  try {
    const mac = req.query.mac?.toUpperCase();
    if (!mac || !mac.match(/^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/)) {
      return res.send('block');
    }

    // 1. Check if manually blocked by admin
    const blocked = queryOne(`SELECT blocked FROM connections WHERE mac=?`, [mac]);
    if (blocked && blocked.blocked === 1) {
      console.log(`[Gateway] ${mac} - MANUALLY BLOCKED`);
      return res.send('block');
    }

    // 2. Check if has valid, active voucher
    const validVoucher = query(`
      SELECT v.* FROM vouchers v
      WHERE v.status='active'
      AND v.expires_at > ?
      AND v.device_id LIKE ?
      LIMIT 1
    `, [Date.now(), '%' + mac.substring(mac.length - 8) + '%']);

    if (validVoucher && validVoucher.length > 0) {
      const v = validVoucher[0];
      console.log(`[Gateway] ${mac} - PAID USER (${v.code})`);
      run(`UPDATE connections SET has_voucher=1 WHERE mac=?`, [mac]);
      return res.send('allow');
    }

    // 3. Check free trial time
    const conn = queryOne(`SELECT connected_at FROM connections WHERE mac=?`, [mac]);
    
    if (!conn) {
      trackConnection(mac);
      console.log(`[Gateway] ${mac} - NEW DEVICE (free trial started)`);
      return res.send('allow');
    }

    const minutesConnected = Math.floor((Date.now() - conn.connected_at) / 60000);
    
    if (minutesConnected < 5) {
      console.log(`[Gateway] ${mac} - FREE TRIAL (${minutesConnected}m / 5m)`);
      return res.send('allow');
    }

    console.log(`[Gateway] ${mac} - TRIAL EXPIRED (${minutesConnected}m used)`);
    return res.send('block');

  } catch(e) {
    console.error('[Gateway Check Error]', e);
    res.send('block');
  }
});

// ─── GATEWAY: Get Trial Time Remaining ────────────────────────────────────────
router.get('/gateway/trial-time', (req, res) => {
  try {
    const mac = req.query.mac?.toUpperCase();
    if (!mac) return res.send('0');

    const conn = queryOne(`SELECT connected_at FROM connections WHERE mac=?`, [mac]);
    
    if (!conn) return res.send('5');
    
    const minutesUsed = Math.floor((Date.now() - conn.connected_at) / 60000);
    const minutesRemaining = Math.max(0, 5 - minutesUsed);
    
    res.send(String(minutesRemaining));
  } catch(e) {
    console.error('[Trial Time Error]', e);
    res.send('0');
  }
});

// ─── GATEWAY: Mark Device as Paid ─────────────────────────────────────────────
router.get('/gateway/mark-paid', (req, res) => {
  try {
    const mac = req.query.mac?.toUpperCase();
    if (!mac) return res.json({ error: 'No MAC' });

    const exists = queryOne(`SELECT id FROM connections WHERE mac=?`, [mac]);
    if (!exists) {
      run(`INSERT INTO connections (mac, connected_at, has_voucher) VALUES (?, ?, 1)`, [mac, Date.now()]);
    } else {
      run(`UPDATE connections SET has_voucher=1 WHERE mac=?`, [mac]);
    }
    
    console.log(`[Gateway] ${mac} - MARKED AS PAID`);
    res.json({ success: true, message: 'Device marked as paid' });
  } catch(e) {
    console.error('[Mark Paid Error]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── BLOCK/UNBLOCK DEVICE (Admin Only) ──────────────────────────────────────

router.post('/admin/block-device', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { mac } = req.body;
    if (!mac || !mac.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)) {
      return res.status(400).json({ error: 'Invalid MAC address' });
    }
    
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
    
    run(`UPDATE connections SET blocked=0 WHERE mac=?`, [mac]);
    res.json({ success: true, message: `Unblocked: ${mac}` });
  } catch(e) {
    console.error('[Unblock Device]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/blocked-devices', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const blocked = query(`SELECT mac, connected_at, blocked FROM connections WHERE blocked=1 ORDER BY connected_at DESC LIMIT 50`);
    res.json({ success: true, blocked });
  } catch(e) {
    console.error('[Blocked Devices]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Session status (polled every 15s by portal) ──────────────────────────────
router.get('/session-status', (req, res) => {
  try {
    if (!req.session.voucher) return res.json({ status: 'no_session' });
    
    const v = req.session.voucher;
    const now = Date.now();
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
  } catch(e) {
    console.error('[Session Status Error]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getUnreadNotifications());
});

router.post('/notifications/:id/read', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    markNotificationRead(req.params.id);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────
router.get('/admin/active-users', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(getActiveUsers());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/refund', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = refundVoucher(req.body.code);
    res.json(result.success 
      ? { success: true, refunded_amount: result.refunded_amount } 
      : { success: false, error: result.error });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/refunds', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(getRefundHistory());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/backups', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(getBackups());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/backup', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(createBackup());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
