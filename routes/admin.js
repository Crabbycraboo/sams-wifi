const express = require('express');
const router = express.Router();
const { supabase, generateVoucherBatch } = require('../db/database');

// Simple session protection check middleware
function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdminAuthenticated) {
    return next();
  }
  res.redirect('/admin/login');
}

// 1. ADMIN LOGIN PAGE
router.get('/login', (req, res) => {
  if (req.session.isAdminAuthenticated) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { 
    title: "Sam's WiFi – Admin Access", 
    error: req.query.error || null 
  });
});

// 2. ADMIN AUTHENTICATION HANDSHAKE
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminSecretPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  if (password === adminSecretPassword) {
    req.session.isAdminAuthenticated = true;
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/admin/login?error=Invalid Administrator Password.');
});

// 3. MASTER EXECUTIVE DASHBOARD PANEL
router.get('/dashboard', requireAdminAuth, async (req, res) => {
  try {
    // A. Pull Active System Overrides
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const systemSettings = {};
    settings?.forEach(s => systemSettings[s.setting_key] = s.setting_value);

    // B. Pull All Selectable Pricing Tiers
    const { data: tiers } = await supabase.from('pricing_tiers').select('*').order('price', { ascending: true });

    // C. Get Live Network Connections Metrics
    const { data: activeSessions } = await supabase
      .from('sessions')
      .select('*, vouchers(duration_minutes, expires_at)');

    // D. SYSTEM SECURITY & ABUSE MATRIX QUERY
    // Aggregate logs to find devices that triggered the trial over 3 times within the past 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: abuseLogs } = await supabase
      .from('logs')
      .select('mac_address')
      .eq('event_type', 'trial_exploit')
      .gt('created_at', twentyFourHoursAgo);

    // Count instances manually since we are using plain REST calls
    const abuseCounts = {};
    abuseLogs?.forEach(log => {
      if (log.mac_address) {
        abuseCounts[log.mac_address] = (abuseCounts[log.mac_address] || 0) + 1;
      }
    });

    const repeaterDevices = Object.keys(abuseCounts)
      .filter(mac => abuseCounts[mac] >= 3)
      .map(mac => ({ mac, count: abuseCounts[mac] }));

    // E. Pull Latest Operational Logs Audit Stream
    const { data: recentLogs } = await supabase
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);

    res.render('admin/dashboard', {
      title: "Sam's WiFi Dashboard",
      settings: systemSettings,
      pricingTiers: tiers || [],
      activeSessions: activeSessions || [],
      repeaterDevices,
      logs: recentLogs || []
    });

  } catch (err) {
    console.error('Admin Dashboard Hydration Failure:', err.message);
    res.render('error', { title: "Admin Error", message: "Failed to load dashboard parameters." });
  }
});

// 4. BATCH VOUCHER FACTORY GENERATOR
router.post('/vouchers/generate', requireAdminAuth, async (req, res) => {
  const { tierId, count } = req.body;
  
  if (!tierId || !count) {
    return res.redirect('/admin/dashboard?error=Missing parameters.');
  }

  try {
    // Read the targets of the selected bracket template
    const { data: tier } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('id', parseInt(tierId))
      .single();

    if (!tier) throw new Error('Selected plan template does not exist.');

    // Fire off the generation array logic into the cloud
    const countInt = parseInt(count) || 20;
    const generatedData = await generateVoucherBatch(tier.id, tier.duration_minutes, countInt);

    // Filter tokens list out to pass into your printable print canvas preview
    const printedTokens = generatedData.map(v => ({
      token: v.token,
      duration: tier.duration_minutes,
      name: tier.name,
      price: tier.price
    }));

    // Render your standard print sheets using your dedicated print stylesheets layout
    res.render('admin/print-sheet', {
      title: `Print Vouchers Batch - ${tier.name}`,
      vouchers: printedTokens
    });

  } catch (err) {
    console.error('Voucher Production Chain Error:', err.message);
    res.redirect('/admin/dashboard?error=Production failed.');
  }
});

// 5. TOGGLE SYSTEM SYSTEM OVERRIDES (Sleep mode or Free Trial Access)
router.post('/settings/toggle', requireAdminAuth, async (req, res) => {
  const { key, value } = req.body; // e.g. key: 'sleep_mode', value: 'true'

  try {
    const { error } = await supabase
      .from('admin_settings')
      .update({ 
        setting_value: value,
        updated_at: new Date().toISOString()
      })
      .eq('setting_key', key);

    if (error) throw error;

    await supabase.from('logs').insert({
      event_type: 'admin_toggle',
      description: `Admin changed setting configuration parameter [${key}] to status: ${value}.`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Toggle Action Update Defect:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. ADMINISTRATIVE ACCOUNT DISCONNECT LOGOUT
router.get('/logout', (req, res) => {
  req.session.isAdminAuthenticated = false;
  res.redirect('/admin/login');
});

module.exports = router;
