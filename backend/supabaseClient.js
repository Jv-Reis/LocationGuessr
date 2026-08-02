const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Usa a secret key (equivalente à antiga service_role) — só roda no servidor,
// nunca deve ser exposta ao navegador.
const supabase = SUPABASE_URL && SUPABASE_SECRET_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
    : null;

module.exports = supabase;
