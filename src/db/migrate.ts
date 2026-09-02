import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

async function runMigrations() {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/whatsapp_crm';

  console.log('⏳ Running database migrations on:', connectionString);
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Database migrations applied successfully!');
  } catch (err: any) {
    console.error('❌ Migration failed:', err?.message || err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();
