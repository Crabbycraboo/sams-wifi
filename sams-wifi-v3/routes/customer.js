const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

router.get('/', async (req, res) => {
  if (req.session.voucherToken) return res.redirect('/portal');
  
  const { data: plans } = await supabase.from('pricing_tiers').select('*').eq('is_active', true);
  res.render('login', { title: "Sam's WiFi", plans: plans || [], gcash: { number: '09287440932', name: 'Aleina Faye Galapate Franco' } });
});

router.get('/portal', async (req, res) => {
  if (!req.session.voucherToken) return res.redirect('/');
  
  const { data: voucher } = await supabase.from('vouchers').select('*').eq('token', req.session.voucherToken).single();
  
  if (!voucher || voucher.status === 'expired') return res.redirect('/expired');

  res.render('portal', {
    title: "Connected",
    voucher: { code: voucher.token, expires_at: new Date(voucher.expires_at).getTime() },
    msRemaining: Math.max(0, new Date(voucher.expires_at).getTime() - Date.now())
  });
});

module.exports = router;
