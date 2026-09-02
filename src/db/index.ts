import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as relations from './relations.js';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/whatsapp_crm';

// Connection client with maximum pool limit
export const queryClient = postgres(connectionString, { max: 15 });

export const db = drizzle(queryClient, {
  schema: { ...schema, ...relations },
});

export type DbClient = typeof db;
