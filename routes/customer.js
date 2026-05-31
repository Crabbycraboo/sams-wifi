const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');

// Main portal route
router.get('/', async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    // Update your render block in routes/customer.js
res.render('login', { 
  title: "Sam's WiFi", 
  plans: plans || [], 
  gcash: { number: '09287440932', name: 'Aleina Faye Galapate Franco' },
  sleepMode: false,
  error: null 
  mac: null
});
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

module.exports = router;
