const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'undefined';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'undefined';

// We won't throw an error here, so the server can at least boot up
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };
