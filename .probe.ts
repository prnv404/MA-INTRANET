import { createClient } from '@supabase/supabase-js';
const pub = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
const { data } = await pub.from('leads').select('lead_id').limit(1).single();
console.log(data?.lead_id);
