const express = require('express');
const router = express.Router();
const { supabase, generateVoucherBatch } = require('../db/database');

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdminAuthenticated) {
    return next();
  }
  res.redirect('/admin/login');
}

// 1. LOGIN PAGE
router.get('/login', (req, res) => {
  if (req.session.isAdminAuthenticated) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', {
    title: "Sam's WiFi – Admin",
    error: req.query.error || null
  });
});

// 2. LOGIN POST
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  if (password === adminPassword) {
    req.session.isAdminAuthenticated = true;
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/admin/login?error=Invalid password.');
});

// 3. DASHBOARD
router.get('/dashboard', requireAdminAuth, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const systemSettings = {};
    settings?.forEach(s => systemSettings[s.setting_key] = s.setting_value);

    const { data: tiers } = await supabase
      .from('pricing_tiers')
      .select('*')
      .order('price', { ascending: true });

    const { data: activeSessions } = await supabase
      .from('sessions')
      .select('*, vouchers(duration_minutes, expires_at)');

    const { data: recentLogs } = await supabase
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);

    // Count vouchers by status
    const { data: voucherCounts } = await supabase
      .from('vouchers')
      .select('status');

    const counts = { unredeemed: 0, active: 0, expired: 0 };
    voucherCounts?.forEach(v => {
      if (counts[v.status] !== undefined) counts[v.status]++;
    });

    res.render('admin/dashboard', {
      title: "Sam's WiFi Dashboard",
      settings: systemSettings,
      pricingTiers: tiers || [],
      activeSessions: activeSessions || [],
      logs: recentLogs || [],
      voucherCounts: counts,
      error: req.query.error || null,
      success: req.query.success || null
    });

  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.render('error', { title: 'Admin Error', message: 'Failed to load dashboard.' });
  }
});

// 4. GENERATE VOUCHERS
router.post('/vouchers/generate', requireAdminAuth, async (req, res) => {
  const { tierId, count } = req.body;

  if (!tierId || !count) {
    return res.redirect('/admin/dashboard?error=Missing tier or count.');
  }

  try {
    const { data: tier, error: tierError } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('id', parseInt(tierId))
      .single();

    if (tierError || !tier) {
      return res.redirect('/admin/dashboard?error=Pricing tier not found.');
    }

    const countInt = Math.min(parseInt(count) || 20, 100); // cap at 100
    const generated = await generateVoucherBatch(tier.id, tier.duration_minutes, countInt);

    const printVouchers = generated.map(v => ({
      token: v.token,
      duration: tier.duration_minutes,
      name: tier.name,
      price: tier.price
    }));

    res.render('admin/vouchers', {
      title: `Vouchers — ${tier.name}`,
      vouchers: printVouchers,
      tier,
      counts: { unredeemed: 0, active: 0, expired: 0 }
    });

  } catch (err) {
    console.error('Voucher generation error:', err.message);
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
  }
});

// 5. TOGGLE SETTINGS
router.post('/settings/toggle', requireAdminAuth, async (req, res) => {
  const { key, value } = req.body;

  try {
    const { error } = await supabase
      .from('admin_settings')
      .update({ setting_value: value, updated_at: new Date().toISOString() })
      .eq('setting_key', key);

    if (error) throw error;

    await supabase.from('logs').insert({
      event_type: 'admin_toggle',
      description: `Setting [${key}] changed to: ${value}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Settings toggle error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. LOGOUT
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
