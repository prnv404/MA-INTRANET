import { sql } from 'drizzle-orm';
import { db, queryClient } from './index';

async function syncContactsSchema() {
  console.log('🔄 Starting Database Contacts Schema Sync (Unified Contacts)...');

  try {
    // 1. ALTER customers table to become the unified contacts table
    console.log('📝 Altering customers table...');
    
    // Drop the old whatsapp_contact_id constraint first
    await db.execute(sql`
      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_whatsapp_contact_id_whatsapp_contacts_id_fk;
    `);

    // Drop the column
    await db.execute(sql`
      ALTER TABLE customers DROP COLUMN IF EXISTS whatsapp_contact_id;
    `);

    // Add new columns
    await db.execute(sql`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS whatsapp_jid TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS contact_type whatsapp_contact_type_enum DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS crm_enabled BOOLEAN DEFAULT false;
    `);

    // Make whatsapp_jid NOT NULL safely by setting it for existing rows if any
    await db.execute(sql`
      UPDATE customers SET whatsapp_jid = whatsapp_number || '@s.whatsapp.net' WHERE whatsapp_jid IS NULL;
    `);

    await db.execute(sql`
      ALTER TABLE customers ALTER COLUMN whatsapp_jid SET NOT NULL;
    `);

    // 2. DROP whatsapp_contacts table
    console.log('🗑️ Dropping whatsapp_contacts table...');
    await db.execute(sql`
      DROP TABLE IF EXISTS whatsapp_contacts CASCADE;
    `);

    console.log('✅ Database contacts schema sync completed successfully!');

  } catch (error) {
    console.error('❌ Failed to sync database schema:', error);
  } finally {
    await queryClient.end();
    process.exit(0);
  }
}

syncContactsSchema();
