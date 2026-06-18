const express = require('express');
const router = express.Router();
const { supabase, generateVoucherBatch } = require('../db/database');

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdminAuthenticated) {
    return next();
  }
  res.redirect('/admin/login');
}
// ADD THIS RIGHT HERE
router.get('/', requireAdminAuth, (req, res) => {
  res.redirect('/admin/dashboard');
});

// 1. LOGIN PAGE
router.get('/login', (req, res) => {
  if (req.session.isAdminAuthenticated) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', {
    title: "39ers – Admin",
    error: req.query.error || null
  });
});

// 2. LOGIN POST
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  if (password === adminPassword) {
    req.session.isAdminAuthenticated = true;
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/admin/login?error=Invalid password.');
});

// 3. DASHBOARD
router.get('/dashboard', requireAdminAuth, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const systemSettings = {};
    settings?.forEach(s => systemSettings[s.setting_key] = s.setting_value);

    const { data: tiers } = await supabase
      .from('pricing_tiers')
      .select('*')
      .order('price', { ascending: true });

    const { data: activeSessions } = await supabase
      .from('sessions')
      .select('*, vouchers(duration_minutes, expires_at)');

    const { data: recentLogs } = await supabase
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);

    const { data: voucherCounts } = await supabase
      .from('vouchers')
      .select('status');

    const counts = { unredeemed: 0, active: 0, expired: 0 };
    voucherCounts?.forEach(v => {
      if (counts[v.status] !== undefined) counts[v.status]++;
    });

    res.render('admin/dashboard', {
      title: "39ers Dashboard",
      settings: systemSettings,
      pricingTiers: tiers || [],
      activeSessions: activeSessions || [],
      logs: recentLogs || [],
      voucherCounts: counts,
      error: req.query.error || null,
      success: req.query.success || null
    });

  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.render('error', { title: 'Admin Error', message: 'Failed to load dashboard.' });
  }
});

// 4. VOUCHERS PAGE (GET)
router.get('/vouchers', requireAdminAuth, async (req, res) => {
  try {
    const currentStatus = req.query.status || 'all';

    let query = supabase
      .from('vouchers')
      .select('token, status, duration_minutes, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (currentStatus !== 'all') {
      query = query.eq('status', currentStatus);
    }

    const { data: vouchers } = await query;

    const { data: allVouchers } = await supabase.from('vouchers').select('status');
    const counts = { all: 0, unredeemed: 0, active: 0, expired: 0, unused: 0 };
    allVouchers?.forEach(v => {
      counts.all++;
      if (counts[v.status] !== undefined) counts[v.status]++;
    });
    counts.unused = counts.unredeemed;

    const { data: tiers } = await supabase.from('pricing_tiers').select('*').order('price', { ascending: true });

    const mapped = (vouchers || []).map(v => ({
      code: v.token,
      plan: `${v.duration_minutes} min`,
      status: v.status === 'unredeemed' ? 'unused' : v.status,
      created_at: v.created_at
    }));

    res.render('admin/vouchers', {
      title: "Vouchers — 39ers",
      vouchers: mapped,
      counts,
      currentStatus,
      pricingTiers: tiers || []
    });

  } catch (err) {
    console.error('Vouchers page error:', err.message);
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
  }
});

// 5. GENERATE VOUCHERS (POST — returns JSON for fetch())
router.post('/vouchers/generate', requireAdminAuth, async (req, res) => {
  const { tierId, count } = req.body;

  if (!tierId || !count) {
    return res.json({ success: false, error: 'Missing tier or count.' });
  }

  try {
    const { data: tier, error: tierError } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('id', parseInt(tierId))
      .single();

    if (tierError || !tier) {
      return res.json({ success: false, error: 'Pricing tier not found.' });
    }

    const countInt = Math.min(parseInt(count) || 20, 100);
    const generated = await generateVoucherBatch(tier.id, tier.duration_minutes, countInt);

    const codes = generated.map(v => v.token);

    res.json({
      success: true,
      count: codes.length,
      codes,
      tier: { name: tier.name, price: tier.price, duration: tier.duration_minutes }
    });

  } catch (err) {
    console.error('Voucher generation error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// 6. TOGGLE SETTINGS
router.post('/settings/toggle', requireAdminAuth, async (req, res) => {
  const { key, value } = req.body;

  try {
    const { error } = await supabase
      .from('admin_settings')
      .update({ setting_value: value, updated_at: new Date().toISOString() })
      .eq('setting_key', key);

    if (error) throw error;

    await supabase.from('logs').insert({
      event_type: 'admin_toggle',
      description: `Setting [${key}] changed to: ${value}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Settings toggle error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. ORDERS PAGE
router.get('/orders', requireAdminAuth, async (req, res) => {
  try {
    const { data: orders } = await supabase
      .from('orders')
      .select('*, pricing_tiers(name, price, duration_minutes)')
      .order('created_at', { ascending: false });

    const { data: tiers } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const counts = {
      pending: 0,
      paidToday: 0,
      cancelled: 0
    };

    (orders || []).forEach(o => {
      if (o.status === 'pending') counts.pending++;
      if (o.status === 'paid' && o.paid_at && o.paid_at >= startOfDay) counts.paidToday++;
      if (o.status === 'cancelled') counts.cancelled++;
    });

    res.render('admin/orders', {
      title: "Orders — 39ers",
      orders: orders || [],
      pricingTiers: tiers || [],
      counts,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('Orders page error:', err.message);
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
  }
});

// 9. CREATE ORDER (POST)
router.post('/orders/create', requireAdminAuth, async (req, res) => {
  const { customer_name, customer_contact, pricing_tier_id } = req.body;

  if (!customer_name || !pricing_tier_id) {
    return res.redirect('/admin/orders?error=' + encodeURIComponent('Name and plan are required.'));
  }

  try {
    const { error } = await supabase.from('orders').insert({
      customer_name: customer_name.trim(),
      customer_contact: customer_contact?.trim() || null,
      pricing_tier_id: parseInt(pricing_tier_id),
      status: 'pending'
    });

    if (error) throw error;

    await supabase.from('logs').insert({
      event_type: 'order_created',
      description: `New order created for ${customer_name.trim()}`
    });

    res.redirect('/admin/orders?success=' + encodeURIComponent('Order created.'));
  } catch (err) {
    res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
  }
});

// 10. MARK ORDER PAID — assigns a voucher, returns JSON
router.post('/orders/:id/pay', requireAdminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*, pricing_tiers(name, price, duration_minutes)')
      .eq('id', id)
      .single();

    if (orderErr || !order) return res.json({ success: false, error: 'Order not found.' });
    if (order.status !== 'pending') return res.json({ success: false, error: 'Order is not pending.' });

    // Find an unused voucher for this tier
    const { data: voucher, error: vErr } = await supabase
      .from('vouchers')
      .select('token')
      .eq('pricing_tier_id', order.pricing_tier_id)
      .eq('status', 'unredeemed')
      .limit(1)
      .single();

    if (vErr || !voucher) {
      return res.json({ success: false, error: 'No unused vouchers available for this plan. Generate more first.' });
    }

    // Update order to paid
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        status: 'paid',
        voucher_token: voucher.token,
        paid_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    await supabase.from('logs').insert({
      event_type: 'order_paid',
      description: `Order paid for ${order.customer_name} — voucher ${voucher.token} assigned`
    });

    res.json({
      success: true,
      voucher: voucher.token,
      plan: order.pricing_tiers?.name,
      customer: order.customer_name
    });
  } catch (err) {
    console.error('Order pay error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// 11. CANCEL ORDER
router.post('/orders/:id/cancel', requireAdminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: order } = await supabase.from('orders').select('customer_name, status').eq('id', id).single();
    if (!order) return res.redirect('/admin/orders?error=Order+not+found.');

    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id);

    await supabase.from('logs').insert({
      event_type: 'order_cancelled',
      description: `Order cancelled for ${order.customer_name}`
    });

    res.redirect('/admin/orders?success=' + encodeURIComponent('Order cancelled.'));
  } catch (err) {
    res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
  }
});

// 12. LOGOUT
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
