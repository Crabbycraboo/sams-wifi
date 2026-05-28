// routes/customer.js
const express = require('express');
const router = express.Router();
const { redeemVoucher, PLANS, checkRateLimit, buildDeviceId, getSleepMode, createNotification, trackConnection, markVoucherPaid } = require('../db/database');

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
  const { code } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const deviceId = buildDeviceId(req);
  const sleepMode = getSleepMode();

  trackConnection(deviceId);

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

  const result = redeemVoucher(code, deviceId);

  if (!result.success) {
    return res.render('login', {
      title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
      error: result.message,
      code: code.toUpperCase()
    });
  }

  // Sleep mode: block cheapest plan
  if (sleepMode && result.voucher.plan === '5min') {
    return res.render('login', {
      title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
      error: '😴 Si Sam ay natutulog. Pinakamababang plano: ₱5. Mag-GCash at makipag-ugnayan para sa code. (Sam is asleep. Min plan is ₱5 – pay via GCash.)',
      code: ''
    });
  }

  markVoucherPaid(deviceId);

  createNotification('sale', `New sale: ₱${result.voucher.price} (${result.voucher.plan})`, {
    code: result.voucher.code,
    price: result.voucher.price,
    plan: result.voucher.plan
  });

  req.session.voucher = {
    code: result.voucher.code,
    plan: result.voucher.plan,
    price: result.voucher.price,
    expires_at: result.voucher.expires_at,
    started_at: result.voucher.started_at || Date.now(),
    device_id: deviceId,
    wifi_password: result.voucher.wifi_password || null,
  };

  res.redirect('/portal');
});

// ─── Portal ───────────────────────────────────────────────────────────────────
router.get('/portal', (req, res) => {
  if (!req.session.voucher) return res.redirect('/');
  const v = req.session.voucher;
  if (buildDeviceId(req) !== v.device_id) {
    req.session.destroy();
    return res.redirect('/');
  }
  if (Date.now() >= v.expires_at) {
    req.session.destroy();
    return res.redirect('/expired');
  }
  res.render('portal', { title: "Sam's WiFi – Konektado", voucher: v, plans: PLANS });
});

// ─── Expired ──────────────────────────────────────────────────────────────────
router.get('/expired', (req, res) => {
  req.session.destroy(() => {});
  res.render('expired', { title: "Sam's WiFi – Natapos na", plans: PLANS });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
