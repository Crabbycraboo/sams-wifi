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
    res.json({ success: true })
