const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// 1. MAIN PORTAL — shows pricing tiers and voucher entry form
router.get('/', async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    const { data: sleepSetting } = await supabase
      .from('admin_settings')
      .select('setting_value')
      .eq('setting_key', 'sleep_mode')
      .single();

    res.render('login', {
      title: "Sam's WiFi",
      plans: plans || [],
      gcash: { number: '09985801867', name: 'Sam' },
      sleepMode: sleepSetting?.setting_value === 'true',
      error: error?.message || null,
      mac: req.query.mac || null
    });
  } catch (err) {
    console.error('Customer portal error:', err.message);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Could not load portal. Please try again.'
    });
  }
});

// 2. VOUCHER REDEMPTION — customer submits a code
router.post('/redeem', async (req, res) => {
  const { code, mac } = req.body;

  if (!code) {
    return res.redirect('/?error=Please enter a voucher code.');
  }

  const cleanCode = code.trim().toUpperCase();
  const cleanMac = mac?.trim() || 'unknown';

  try {
    // Look up voucher in Supabase
    const { data: voucher, error } = await supabase
      .from('vouchers')
      .select('*, pricing_tiers(name, price)')
      .eq('token', cleanCode)
      .single();

    if (error || !voucher) {
      return res.redirect('/?error=Invalid voucher code.');
    }

    if (voucher.status !== 'unredeemed') {
      return res.redirect('/?error=This code has already been used.');
    }

    // Calculate expiry
    const now = new Date();
    const expiresAt = new Date(now.getTime() + voucher.duration_minutes * 60 * 1000).toISOString();

    // Mark voucher as active
    await supabase
      .from('vouchers')
      .update({ status: 'active', expires_at: expiresAt })
      .eq('token', cleanCode);

    // Create session
    await supabase.from('sessions').upsert({
      voucher_token: cleanCode,
      mac_address: cleanMac,
      ip_address: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0',
      last_ping: now.toISOString()
    }, { onConflict: 'voucher_token' });

    // Log it
    await supabase.from('logs').insert({
      mac_address: cleanMac,
      event_type: 'voucher_redeemed',
      description: `Voucher ${cleanCode} redeemed for ${voucher.duration_minutes} minutes.`
    });

    // Store in session
    req.session.voucherToken = cleanCode;
    req.session.expiresAt = expiresAt;
    req.session.macAddress = cleanMac;
    req.session.durationMinutes = voucher.duration_minutes;

    return res.redirect('/portal');

  } catch (err) {
    console.error('Redemption error:', err.message);
    return res.redirect('/?error=Server error. Please try again.');
  }
});

// 3. ACTIVE SESSION PORTAL — countdown timer page
router.get('/portal', async (req, res) => {
  if (!req.session.voucherToken || !req.session.expiresAt) {
    return res.redirect('/');
  }

  const now = Date.now();
  const expiresAt = new Date(req.session.expiresAt).getTime();
  const remainingMs = expiresAt - now;

  if (remainingMs <= 0) {
    req.session.destroy();
    return res.redirect('/expired');
  }

  res.render('portal', {
    title: "Sam's WiFi — Connected",
    expiresAt: req.session.expiresAt,
    remainingSeconds: Math.floor(remainingMs / 1000),
    durationMinutes: req.session.durationMinutes || 0,
    voucherToken: req.session.voucherToken
  });
});

// 4. EXPIRED PAGE
router.get('/expired', (req, res) => {
  res.render('expired', { title: "Sam's WiFi — Session Expired" });
});

// 5. ROUTER GATEWAY CHECK — router pings this to allow/block a MAC
router.get('/api/gateway/check', async (req, res) => {
  const clientMac = req.query.mac?.trim();
  if (!clientMac) return res.send('block');

  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*, vouchers(status, expires_at)')
      .eq('mac_address', clientMac)
      .maybeSingle();

    if (!session?.vouchers) return res.send('block');

    const expired = Date.now() > new Date(session.vouchers.expires_at).getTime();
    if (expired) {
      await supabase.from('sessions').delete().eq('mac_address', clientMac);
      await supabase.from('vouchers').update({ status: 'expired' }).eq('token', session.voucher_token);
      return res.send('block');
    }

    return res.send('allow');
  } catch (err) {
    console.error('Gateway check error:', err.message);
    return res.send('block');
  }
});

module.exports = router;
