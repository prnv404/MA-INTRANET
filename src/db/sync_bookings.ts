import { sql } from 'drizzle-orm';
import { db, queryClient } from './index';

async function syncBookingsSchema() {
  console.log('🔄 Starting Database Booking Schema Sync...');

  try {
    // 1. Create new ENUM
    console.log('📝 Creating boat_category_enum...');
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE boat_category_enum AS ENUM ('deluxe', 'premium', 'luxury');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. Alter BOATS table
    console.log('🚤 Altering boats table...');
    await db.execute(sql`
      ALTER TABLE boats
      ADD COLUMN IF NOT EXISTS boat_category boat_category_enum DEFAULT 'deluxe';
    `);
    
    // We attempt to drop boat_type safely
    await db.execute(sql`
      ALTER TABLE boats DROP COLUMN IF EXISTS boat_type;
    `);

    // 3. Alter BOOKINGS table
    console.log('📅 Altering bookings table...');
    
    // Add new columns
    await db.execute(sql`
      ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS check_in_date DATE,
      ADD COLUMN IF NOT EXISTS check_out_date DATE,
      ADD COLUMN IF NOT EXISTS check_in_time TEXT,
      ADD COLUMN IF NOT EXISTS check_out_time TEXT,
      ADD COLUMN IF NOT EXISTS adults_count INTEGER,
      ADD COLUMN IF NOT EXISTS children_count INTEGER,
      ADD COLUMN IF NOT EXISTS veg_meals INTEGER,
      ADD COLUMN IF NOT EXISTS non_veg_meals INTEGER,
      ADD COLUMN IF NOT EXISTS boarding_point TEXT,
      ADD COLUMN IF NOT EXISTS dropping_point TEXT,
      ADD COLUMN IF NOT EXISTS boat_category boat_category_enum,
      ADD COLUMN IF NOT EXISTS boat_price NUMERIC,
      ADD COLUMN IF NOT EXISTS extra_charges NUMERIC,
      ADD COLUMN IF NOT EXISTS total_price NUMERIC,
      ADD COLUMN IF NOT EXISTS advance_paid NUMERIC,
      ADD COLUMN IF NOT EXISTS balance_amount NUMERIC,
      ADD COLUMN IF NOT EXISTS special_requests TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // Drop old columns
    await db.execute(sql`
      ALTER TABLE bookings
      DROP COLUMN IF EXISTS travel_date,
      DROP COLUMN IF EXISTS quoted_price,
      DROP COLUMN IF EXISTS final_price;
    `);

    console.log('✅ Database booking schema sync completed successfully!');

  } catch (error) {
    console.error('❌ Failed to sync database schema:', error);
  } finally {
    await queryClient.end();
    process.exit(0);
  }
}

syncBookingsSchema();
