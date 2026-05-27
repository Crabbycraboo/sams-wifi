// routes/customer.js — with sleep mode + ₱5 restriction + GCash display
const express = require('express');
const router = express.Router();
const { redeemVoucher, PLANS, checkRateLimit, buildDeviceId, getSleepMode } = require('../db/database');

const GCASH = {
  number: '09287440932',
  name:   'Aleina Faye Galapate Franco',
};

// ─── Home / Login ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  if (req.session.voucher) return res.redirect('/portal');
  const sleepMode = getSleepMode();
  res.render('login', {
    title: "Sam's WiFi",
    plans: PLANS,
    error: null,
    code: '',
    sleepMode,
    gcash: GCASH,
  });
});

// ─── Voucher submission ───────────────────────────────────────────────────────
router.post('/connect', (req, res) => {
  const { code } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const deviceId = buildDeviceId(req);
  const sleepMode = getSleepMode();

  // Rate limit — 10 attempts per 5 minutes
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
const { createNotification } = require('../db/database');
  
  // Sleep mode: block ₱5 / 30min vouchers
  if (sleepMode && result.voucher.plan === '30min') {
    return res.render('login', {
      title: "Sam's WiFi", plans: PLANS, sleepMode, gcash: GCASH,
      error: '⚠️ Si Sam ay natutulog. Ang pinakamababang plano ngayon ay ₱10. Mag-GCash at makipag-ugnayan para sa iyong code. (Sam is asleep. Minimum plan is ₱10. Pay via GCash and message for your code.)',
      code: ''
    });
  }

  req.session.voucher = {
    code: result.voucher.code,
    plan: result.voucher.plan,
    price: result.voucher.price,
    expires_at: result.voucher.expires_at,
    device_id: deviceId,
    wifi_password: result.voucher.wifi_password || null,
  };

  res.redirect('/portal');
});
createNotification('sale', `New sale: ₱${result.voucher.price} (${result.voucher.plan})`, {
  code: result.voucher.code,
  price: result.voucher.price,
  plan: result.voucher.plan
});
// ─── Portal ───────────────────────────────────────────────────────────────────
router.get('/portal', (req, res) => {
  if (!req.session.voucher) return res.redirect('/');

  const v = req.session.voucher;
  const now = Date.now();

  const currentDevice = buildDeviceId(req);
  if (currentDevice !== v.device_id) {
    req.session.destroy();
    return res.redirect('/');
  }

  if (now >= v.expires_at) {
    req.session.destroy();
    return res.redirect('/expired');
  }

  res.render('portal', { title: "Sam's WiFi - Connected", voucher: v, plans: PLANS });
});

// ─── Expired ──────────────────────────────────────────────────────────────────
router.get('/expired', (req, res) => {
  req.session.destroy(() => {});
  res.render('expired', { title: "Sam's WiFi - Session Expired", plans: PLANS });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
