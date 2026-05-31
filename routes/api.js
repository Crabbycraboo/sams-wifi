const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// Session status poll — called by the portal countdown timer every 30s
router.get('/status', async (req, res) => {
  if (!req.session.voucherToken || !req.session.expiresAt) {
    return res.json({ active: false });
  }

  const remainingMs = new Date(req.session.expiresAt).getTime() - Date.now();

  if (remainingMs <= 0) {
    req.session.destroy();
    return res.json({ active: false, expired: true });
  }

  // Update last_ping in sessions table
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

module.exports = router;
