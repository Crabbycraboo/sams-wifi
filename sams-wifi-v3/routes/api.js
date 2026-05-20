// routes/api.js — hardened with faster polling + device re-verification
const express = require('express');
const router = express.Router();
const { queryOne, getActiveUsers, getLoadRecommendation, buildDeviceId } = require('../db/database');

// ─── Session status (polled every 15s by portal) ──────────────────────────────
router.get('/session-status', (req, res) => {
  if (!req.session.voucher) {
    return res.json({ status: 'no_session' });
  }

  const v = req.session.voucher;
  const now = Date.now();
  const msRemaining = v.expires_at - now;

  if (msRemaining <= 0) {
    req.session.destroy();
    return res.json({ status: 'expired' });
  }

  // Verify device fingerprint hasn't changed mid-session (catches tab sharing)
  const currentDevice = buildDeviceId(req);
  if (currentDevice !== v.device_id) {
    req.session.destroy();
    return res.json({ status: 'device_mismatch' });
  }

  // Verify DB still shows this as active (catches server-side expiry)
  const dbVoucher = queryOne('SELECT status, expires_at FROM vouchers WHERE code = ?', [v.code]);
  if (!dbVoucher || dbVoucher.status === 'expired') {
    req.session.destroy();
    return res.json({ status: 'expired' });
  }

  // Use DB expires_at as the authoritative source
  const authoritativeRemaining = dbVoucher.expires_at - now;
  if (authoritativeRemaining <= 0) {
    req.session.destroy();
    return res.json({ status: 'expired' });
  }

  res.json({
    status: 'active',
    msRemaining: authoritativeRemaining,
    code: v.code,
    plan: v.plan,
    expires_at: dbVoucher.expires_at
  });
});

// ─── Admin: active users ──────────────────────────────────────────────────────
router.get('/admin/active-users', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getActiveUsers());
});

// ─── Admin: load recommendation ───────────────────────────────────────────────
router.get('/admin/load-rec', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getLoadRecommendation());
});

module.exports = router;
