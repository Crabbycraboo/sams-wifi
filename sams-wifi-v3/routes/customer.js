const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

const GCASH = {
  number: '09287440932',
  name:   'Aleina Faye Galapate Franco',
};

// 1. HOME / PORTAL SPLASH ENTRY
router.get('/', async (req, res) => {
  // If they are already marked as authenticated in their browser session, take them to the live ring timer
  if (req.session.voucherToken) {
    return res.redirect('/portal');
  }

  // Captures the physical hardware signature sent by your OpenWrt router redirect
  // If they loaded the page manually, it preserves whatever MAC address was already tucked into their session cookie
  const incomingMac = req.query.mac || req.session.macAddress || '';
  if (incomingMac) {
    req.session.macAddress = incomingMac.trim();
  }

  try {
    // Dynamically pull pricing configurations straight from your Supabase cloud tables
    const { data: plans } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    // Read global system override flags (like Sleep Mode)
    const { data: sleepSetting } = await supabase
      .from('admin_settings')
      .select('setting_value')
      .eq('setting_key', 'sleep_mode')
      .single();

    const isSleepMode = sleepSetting?.setting_value === 'true';

    // Renders your beautiful frosted card interface passing real-time cloud conditions
    res.render('login', {
      title: "Sam's WiFi v3.0",
      plans: plans || [],
      error: req.query.error || null,
      code: req.query.code || '',
      sleepMode: isSleepMode,
      gcash: GCASH,
      mac: req.session.macAddress || ''
    });
  } catch (err) {
    console.error('Portal Entry Failure:', err.message);
    res.render('error', { title: "Portal Error", message: "Hindi makakonekta sa server. Please refresh." });
  }
});

// 2. VOUCHER REDEMPTION HANDSHAKE
router.post('/connect', async (req, res) => {
  const { code } = req.body;
  const clientMac = req.session.macAddress || req.body.mac || '';

  if (!code) {
    return res.redirect('/?error=Mangyaring ilagay ang iyong voucher code.');
  }

  const cleanCode = code.trim().toUpperCase();

  try {
    // 1. Cross-reference voucher tokens from your live cloud table
    const { data: voucher, error: vError } = await supabase
      .from('vouchers')
      .select('*')
      .eq('token', cleanCode)
      .single();

    if (vError || !voucher) {
      return res.redirect(`/?error=Hindi nahanap ang voucher code. Subukan muli.&code=${cleanCode}`);
    }

    if (voucher.status === 'expired') {
      return res.redirect('/expired');
    }

    const rightNow = new Date();
    let expirationTimestamp;

    // 2. If voucher is pristine ('unredeemed'), kickstart its real-time countdown timeline
    if (voucher.status === 'unredeemed') {
      const durationMs = voucher.duration_minutes * 60 * 1000;
      expirationTimestamp = new Date(rightNow.getTime() + durationMs).toISOString();

      const { error: activateError } = await supabase
        .from('vouchers')
        .update({
          status: 'active',
          expires_at: expirationTimestamp
        })
        .eq('token', cleanCode);

      if (activateError) throw activateError;
    } else {
      // If it was already active, preserve its pre-existing expiration checkpoint
      expirationTimestamp = voucher.expires_at;
    }

    // 3. Bind the active cloud network connection session to this device's MAC fingerprint
    const { error: sessionError } = await supabase
      .from('sessions')
      .upsert({
        voucher_token: cleanCode,
        mac_address: clientMac || '00:00:00:00:00:00',
        ip_address: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '192.168.1.1',
        last_ping: rightNow.toISOString()
      }, { onConflict: 'voucher_token' });

    if (sessionError) throw sessionError;

    // Log tracking elements inside client secure state storage
    req.session.voucherToken = cleanCode;
    req.session.expiresAt = expirationTimestamp;

    // Log the successful entrance into system audit logs
    await supabase.from('logs').insert({
      mac_address: clientMac,
      event_type: 'voucher_redeem',
      description: `Voucher ${cleanCode} (${voucher.duration_minutes}m) successfully activated.`
    });

    // Take them straight to the live circular UI interface
    res.redirect('/portal');

  } catch (err) {
    console.error('Authentication Router Error:', err.message);
    res.redirect('/?error=Server error occurred. Please try again.');
  }
});

// 3. THE LIVE SESSION MANAGER VIEW (COUNTDOWN ARENA)
router.get('/portal', async (req, res) => {
  if (!req.session.voucherToken) {
    return res.redirect('/');
  }

  try {
    // Keep internal values closely mapped to client countdown clocks
    const { data: voucher } = await supabase
      .from('vouchers')
      .select('*')
      .eq('token', req.session.voucherToken)
      .single();

    if (!voucher || voucher.status === 'expired') {
      req.session.destroy(() => {});
      return res.redirect('/expired');
    }

    const msRemaining = Math.max(0, new Date(voucher.expires_at).getTime() - Date.now());
    const minsRemaining = Math.floor(msRemaining / 60000);
    const secsRemaining = Math.floor((msRemaining % 60000) / 1000);

    res.render('portal', {
      title: "Sam's WiFi – Connected",
      voucher: {
        code: voucher.token,
        expires_at: new Date(voucher.expires_at).getTime()
      },
      minsRemaining,
      secsRemaining,
      msRemaining
    });
  } catch (err) {
    console.error('Portal Rendering Error:', err.message);
    res.redirect('/');
  }
});

// 4. TERMINAL TIMEOUT LANDING PAGE
router.get('/expired', (req, res) => {
  req.session.destroy(() => {});
  res.render('expired', {
    title: "Sam's WiFi – Oras mo ay Naubos na",
    gcash: GCASH
  });
});

// 5. SESSION TEARDOWN DISCONNECT ROUTE
router.post('/logout', async (req, res) => {
  const currentToken = req.session.voucherToken;
  if (currentToken) {
    // Gracefully clean out network tracking records from the cloud session cluster
    await supabase.from('sessions').delete().eq('voucher_token', currentToken);
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
