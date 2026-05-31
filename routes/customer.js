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
router.get('/', async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('is_active', true);

    // Default data object to prevent "is not defined" errors
    const viewData = {
      title: "Sam's WiFi",
      plans: plans || [],
      gcash: { number: '09287440932', name: 'Aleina Faye Galapate Franco' },
      sleepMode: false,
      error: null,
      mac: null,
      // Add any other variables your template uses here as null or defaults
    };

    if (error) viewData.error = error.message;

    res.render('login', viewData);
  } catch (err) {
    console.error("Route Error:", err);
    res.status(500).send("Server Error - Please check logs.");
  }
});
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

module.exports = router;
