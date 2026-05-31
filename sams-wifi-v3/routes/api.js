const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// 1. ROUTER GATEWAY CHECK ENDPOINT
// Your TP-Link router pings this to ask: "Should I let this MAC address browse?"
router.get('/gateway/check', async (req, res) => {
  const clientMac = req.query.mac;

  if (!clientMac) {
    return res.send('block');
  }

  const cleanMac = clientMac.trim();

  try {
    // Look up if there's an active session matching this hardware signature
    const { data: session, error } = await supabase
      .from('sessions')
      .select('*, vouchers(status, expires_at)')
      .eq('mac_address', cleanMac)
      .maybeSingle();

    if (error || !session || !session.vouchers) {
      return res.send('block');
    }

    // Check if the voucher has hit its deadline expiration
    const expirationTime = new Date(session.vouchers.expires_at).getTime();
    if (Date.now() > expirationTime) {
      // Clean up the expired tracking records automatically
      await supabase.from('sessions').delete().eq('mac_address', cleanMac);
      await supabase.from('vouchers').update({ status: 'expired' }).eq('token', session.voucher_token);
      return res.send('block');
    }

    // If session is active and time hasn't run out, tell the router to grant internet!
    return res.send('allow');
  } catch (err) {
    console.error('API Gateway Check Failure:', err.message);
    return res.send('block'); // Fallback to safe mode on error
  }
});

// 2. FREE TRIAL ACTIVATION REGISTRATION ENGINE
router.post('/trial/activate', async (req, res) => {
  const { mac } = req.body;

  if (!mac) {
    return res.status(400).json({ success: false, message: 'Missing device fingerprint.' });
  }

  const cleanMac = mac.trim();

  try {
    // Check if global system settings allow trials right now
    const { data: trialSetting } = await supabase
      .from('admin_settings')
      .select('setting_value')
      .eq('setting_key', 'trial_allowed')
      .single();

    if (trialSetting?.setting_value !== 'true') {
      return res.status(403).json({ success: false, message: 'Ang free trial ay kasalukuyang sarado.' });
    }

    // ABUSE PREVENTION MATRIX CHECK: 
    // Scan audit logs to see if this MAC address has already claimed a trial today
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pastTrials, error: logError } = await supabase
      .from('logs')
      .select('id')
      .eq('mac_address', cleanMac)
      .eq('event_type', 'trial_exploit')
      .gt('created_at', twentyFourHoursAgo);

    if (pastTrials && pastTrials.length >= 3) {
      // Log the abuse attempt automatically
      await supabase.from('logs').insert({
        mac_address: cleanMac,
        event_type: 'trial_abuse_flag',
        description: `Device attempted to loop free trial. Blocked by system.`
      });
      return res.status(429).json({ success: false, message: 'Naabot mo na ang limitasyon para sa araw na ito.' });
    }

    const rightNow = new Date();
    const trialDurationMinutes = 5; // Standard 5 Minute Free Pass
    const expirationTimestamp = new Date(rightNow.getTime() + trialDurationMinutes * 60 * 1000).toISOString();

    // Create a shadow voucher for this trial user to keep data relational
    const shadowToken = `TRIAL-${cleanMac.replace(/:/g, '').slice(-6).toUpperCase()}`;

    // Insert shadow voucher
    await supabase.from('vouchers').upsert({
      token: shadowToken,
      duration_minutes: trialDurationMinutes,
      status: 'active',
      expires_at: expirationTimestamp
    });

    // Create the active hardware session mapping
    await supabase.from('sessions').upsert({
      voucher_token: shadowToken,
      mac_address: cleanMac,
      ip_address: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '192.168.1.1',
      last_ping: rightNow.toISOString()
    }, { onConflict: 'voucher_token' });

    // Track the entry inside audit records
    await supabase.from('logs').insert({
      mac_address: cleanMac,
      event_type: 'trial_exploit',
      description: `Free 5-minute activation granted to device.`
    });

    // Store structural credentials inside client session storage
    req.session.voucherToken = shadowToken;
    req.session.expiresAt = expirationTimestamp;
    req.session.macAddress = cleanMac;

    return res.json({ success: true, redirect: '/portal' });

  } catch (err) {
    console.error('Free Trial Engine Error:', err.message);
    return res.status(500).json({ success: false, message: 'Nagkaroon ng server error.' });
  }
});

module.exports = router;
