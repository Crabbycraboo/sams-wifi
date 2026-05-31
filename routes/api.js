const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// Session status poll — called by the portal countdown timer every 30s
router.get('/status', async (req, res) => {
  if (!req.session.voucherToken || !req.session.expiresAt) {
    return res.json({ active: false });
  }
  const remainingMs = new Date(req.session.expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) {
    req.session.destroy();
    return res.json({ active: false, expired: true });
  }
  await supabase
    .from('sessions')
    .update({ last_ping: new Date().toISOString() })
    .eq('voucher_token', req.session.voucherToken);
  return res.json({
    active: true,
    remainingSeconds: Math.floor(remainingMs / 1000),
    expiresAt: req.session.expiresAt
  });
});

// Called by the router (no HTTPS needed on router side)
router.get('/redeem', async (req, res) => {
  const code = req.query.code;
  const mac  = req.query.mac;
  if (!code) return res.json({ ok: false, error: 'no code' });

  const { data, error } = await supabase
    .from('vouchers')
    .select('token, status, duration_minutes')
    .eq('token', code.toUpperCase())
    .single();

  if (error || !data) return res.json({ ok: false, error: 'invalid' });
  if (data.status !== 'unredeemed') return res.json({ ok: false, error: 'used' });

  await supabase
    .from('vouchers')
    .update({ status: 'active' })
    .eq('token', code.toUpperCase());

  res.json({ ok: true, duration: data.duration_minutes });
});

module.exports = router;
