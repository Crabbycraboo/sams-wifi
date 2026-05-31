const { createClient } = require('@supabase/supabase-js');

// These process.env variables will be securely injected by Vercel
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Critical Error: Missing Supabase Credentials in Environment Variables!");
}

// Initialize the master Supabase Cloud client
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Generates automated unique access voucher tokens (e.g., SAM-X7R9)
 * @param {number} pricingTierId - The sequential ID from your pricing_tiers table
 * @param {number} durationMinutes - Amount of internet time granted
 * @param {number} count - Total vouchers to batch insert (e.g., 20 for a full grid sheet)
 */
async function generateVoucherBatch(pricingTierId, durationMinutes, count) {
  const vouchersToInsert = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing 0, O, 1, or I characters

  for (let i = 0; i < count; i++) {
    let randomPart = '';
    for (let j = 0; j < 4; j++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const tokenCode = `SAM-${randomPart}`;

    vouchersToInsert.push({
      token: tokenCode,
      pricing_tier_id: pricingTierId,
      duration_minutes: durationMinutes,
      status: 'unredeemed'
    });
  }

  // Push the complete batch to your cloud table in a single network round-trip
  const { data, error } = await supabase
    .from('vouchers')
    .insert(vouchersToInsert)
    .select();

  if (error) {
    console.error('❌ Supabase Batch Insertion Failed:', error.message);
    throw error;
  }

  return data;
}

module.exports = {
  supabase,
  generateVoucherBatch
};
