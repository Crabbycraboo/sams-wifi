const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Generates a random voucher token in 39ERS-XXXXXXXX format
function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `39ERS-${code}`;
}

// Generates a batch of vouchers and inserts them into Supabase
async function generateVoucherBatch(tierId, durationMinutes, count = 20) {
  const vouchers = [];

  for (let i = 0; i < count; i++) {
    vouchers.push({
      token: generateToken(),
      pricing_tier_id: tierId,
      duration_minutes: durationMinutes,
      status: 'unredeemed'
    });
  }

  const { data, error } = await supabase
    .from('vouchers')
    .insert(vouchers)
    .select();

  if (error) throw new Error(`Voucher insert failed: ${error.message}`);
  return data;
}

module.exports = { supabase, generateVoucherBatch };
