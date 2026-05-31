// routes/customer.js - FIXED VERSION

const express = require('express');
const router = express.Router();
const { 
  redeemVoucher, PLANS, checkRateLimit, buildDeviceId, getSleepMode, 
  createNotification, trackConnection, markVoucherPaid, queryOne 
} = require('../db/database');

const GCASH = {
  number: '09287440932',
  name:   'Aleina Faye Galapate Franco',
};

// ─── Home / Login ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  if (req.session.voucher) return res.redirect('/portal');
  res.render('login', {
    title: "Sam's WiFi",
    plans: PLANS,
    error: null,
    code: '',
    sleepMode: getSleepMode(),
    gcash: GCASH,
  });
});

// ─── Voucher submission ───────────────────────────────────────────────────────
router.post('/connect', (req, res) => {
  try {
    const { code, mac } = req.body;  // ← mac can be passed from router
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const deviceId = mac || buildDeviceId(req);  // ← Use MAC if available, else fingerprint
    const sleepMode = getSleepMode();

    // Track free trial connection (by MAC if available)
   // Track free trial connection (by MAC if available, else by device fingerprint)
const trackMac = mac || buildDeviceId(req);
trackConnection(trackMac);

    const rateCheck = checkRateLimit(ip, 'code_attempt');
    if (!rateCheck.allowed) {
      return res.render('login', {
        title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
        error: `Too many attempts. Please wait ${rateCheck.retryMins} minute(s).`,
        code: ''
      });
    }

    if (!code || code.trim().length < 4) {
      return res.render('login', {
        title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
        error: 'Please enter your voucher code.',
        code: code || ''
      });
    }

    // Redeem the voucher
    const result = redeemVoucher(code, deviceId);

    if (!result.success) {
      return res.render('login', {
        title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
        error: result.message,
        code: code.toUpperCase()
      });
    }

    // Sleep mode: block ₱2 plan
    if (sleepMode && result.voucher.plan === '5min') {
      return res.render('login', {
        title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
        error: '😴 Si Sam ay natutulog. Minimum: ₱5. Magbayad via GCash: 09287440932 (Sam is sleeping. Min ₱5)',
        code: ''
      });
    }

    // Mark as paid (update connections table if MAC is available)
    if (mac) {
      markVoucherPaid(mac);
    }

    // Create notification
    createNotification('sale', `✅ Sale: ₱${result.voucher.price} (${result.voucher.plan})`, {
      code: result.voucher.code,
      price: result.voucher.price,
      plan: result.voucher.plan
    });

    // Store in session
    req.session.voucher = {
      code: result.voucher.code,
      plan: result.voucher.plan,
      price: result.voucher.price,
      expires_at: result.voucher.expires_at,
      started_at: result.voucher.started_at || Date.now(),
      device_id: deviceId,
      mac: mac || null,
      wifi_password: result.voucher.wifi_password || null,
    };

    // Redirect to portal
    res.redirect('/portal');

  } catch(e) {
    console.error('[Connect Error]', e);
    res.render('login', {
      title: "Sam's WiFi",
      plans: PLANS,
      sleepMode: getSleepMode(),
      gcash: GCASH,
      error: 'Server error. Please try again.',
      code: req.body.code || ''
    });
  }
});

// ─── Portal (Countdown Timer) ──────────────────────────────────────────────────
router.get('/portal', (req, res) => {
  try {
    if (!req.session.voucher) return res.redirect('/');
    
    const v = req.session.voucher;

    // Check if expired
    const now = Date.now();
    if (now >= v.expires_at) {
      req.session.destroy();
      return res.redirect('/expired');
    }

    // Calculate time remaining
    const msRemaining = v.expires_at - now;
    const minsRemaining = Math.floor(msRemaining / 60000);
    const secsRemaining = Math.floor((msRemaining % 60000) / 1000);

    res.render('portal', {
      title: "Sam's WiFi – Connected",
      voucher: v,
      plans: PLANS,
      minsRemaining,
      secsRemaining,
      msRemaining
    });
  } catch(e) {
    console.error('[Portal Error]', e);
    res.redirect('/');
  }
});

// ─── Expired ──────────────────────────────────────────────────────────────────
router.get('/expired', (req, res) => {
  try {
    req.session.destroy(() => {});
    res.render('expired', {
      title: "Sam's WiFi – Time's Up",
      plans: PLANS,
      gcash: GCASH
    });
  } catch(e) {
    res.render('expired', { title: "Sam's WiFi", plans: PLANS, gcash: GCASH });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  try {
    req.session.destroy(() => {});
  } catch(e) {}
  res.redirect('/');
});

// ─── API: Check Time Remaining ────────────────────────────────────────────────
router.get('/api/time-remaining', (req, res) => {
  if (!req.session.voucher) return res.json({ error: 'Not connected' });
  
  const v = req.session.voucher;
  const msRemaining = Math.max(0, v.expires_at - Date.now());
  const minsRemaining = Math.floor(msRemaining / 60000);
  const secsRemaining = Math.floor((msRemaining % 60000) / 1000);
  
  res.json({
    minsRemaining,
    secsRemaining,
    msRemaining,
    expired: msRemaining <= 0,
    code: v.code,
    plan: v.plan
  });
});

module.exports = router;
