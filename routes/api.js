const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// Session status poll
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

// Called by the router CGI script
router.get('/redeem', async (req, res) => {
  const code = (req.query.code || '').toUpperCase();
  const mac  = req.query.mac || 'unknown';
  const ip   = req.query.ip || req.ip || 'unknown';
  if (!code) return res.json({ ok: false, error: 'no code' });
  const { data, error } = await supabase
    .from('vouchers')
    .select('token, status, duration_minutes')
    .eq('token', code)
    .single();
  if (error || !data) return res.json({ ok: false, error: 'invalid' });
  if (data.status !== 'unredeemed') return res.json({ ok: false, error: 'used' });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + data.duration_minutes * 60 * 1000);
  await supabase
    .from('vouchers')
    .update({ status: 'active', expires_at: expiresAt.toISOString() })
    .eq('token', code);
  await supabase
    .from('sessions')
    .insert({ voucher_token: code, mac_address: mac, ip_address: ip });
  await supabase
    .from('logs')
    .insert({
      mac_address: mac,
      event_type: 'redeem',
      description: `Voucher ${code} redeemed. Duration: ${data.duration_minutes} min. Expires: ${expiresAt.toISOString()}`
    });
  res.json({ ok: true, duration: data.duration_minutes });
});

// Called by the router when a session expires
router.get('/expire', async (req, res) => {
  const code = (req.query.code || '').toUpperCase();
  const mac  = req.query.mac || 'unknown';
  if (!code) return res.json({ ok: false });
  await supabase
    .from('vouchers')
    .update({ status: 'expired' })
    .eq('token', code);
  await supabase
    .from('sessions')
    .delete()
    .eq('voucher_token', code);
  await supabase
    .from('logs')
    .insert({
      mac_address: mac,
      event_type: 'expire',
      description: `Voucher ${code} expired. MAC: ${mac}`
    });
  res.json({ ok: true });
});

// Free trial — one per MAC address
router.get('/trial', async (req, res) => {
  const mac = req.query.mac || 'unknown';
  const { data: existing } = await supabase
    .from('logs')
    .select('id')
    .eq('mac_address', mac)
    .eq('event_type', 'trial')
    .single();
  if (existing) return res.json({ ok: false, error: 'Trial already used' });
  const { data: tier } = await supabase
    .from('pricing_tiers')
    .select('duration_minutes')
    .eq('price', 0)
    .single();
  if (!tier) return res.json({ ok: false, error: 'No trial available' });
  await supabase.from('logs').insert({
    mac_address: mac,
    event_type: 'trial',
    description: `Free trial used by MAC: ${mac}`
  });
  res.json({ ok: true, duration: tier.duration_minutes });
});

module.exports = router;
