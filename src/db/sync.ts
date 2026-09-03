import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatsapp_crm';
const sql = postgres(connectionString);

async function sync() {
  console.log('⏳ Altering database tables to remove obsolete conversation and AI analysis columns/tables...');
  try {
    await sql`ALTER TABLE messages DROP COLUMN IF EXISTS conversation_id CASCADE;`;
    await sql`ALTER TABLE messages DROP COLUMN IF EXISTS ai_processed_at CASCADE;`;
    await sql`ALTER TABLE messages DROP COLUMN IF EXISTS ai_analysis_id CASCADE;`;
    await sql`ALTER TABLE whatsapp_contacts DROP COLUMN IF EXISTS ai_enabled CASCADE;`;
    await sql`ALTER TABLE bookings DROP COLUMN IF EXISTS conversation_id CASCADE;`;
    await sql`DROP TABLE IF EXISTS ai_analysis CASCADE;`;
    await sql`DROP TABLE IF EXISTS conversation_events CASCADE;`;
    await sql`DROP TABLE IF EXISTS conversation_state CASCADE;`;
    await sql`DROP TABLE IF EXISTS conversations CASCADE;`;
    await sql`DROP TYPE IF EXISTS conversation_status_enum CASCADE;`;
    await sql`DROP TYPE IF EXISTS event_type_enum CASCADE;`;
    await sql`DROP TYPE IF EXISTS performed_by_type_enum CASCADE;`;
    console.log('✅ Database schema updated successfully!');
  } catch (err) {
    console.error('❌ Error altering schema:', err);
  } finally {
    await sql.end();
  }
}

sync();
