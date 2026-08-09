import "dotenv/config";
import { Client } from "pg";

async function run() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  await c.connect();
  await c.query(`
    ALTER TABLE p2p_requests 
    ADD COLUMN IF NOT EXISTS type VARCHAR(4) NOT NULL DEFAULT 'SELL' CHECK (type IN ('BUY', 'SELL')),
    ADD COLUMN IF NOT EXISTS creator_confirmed BOOLEAN DEFAULT false, 
    ADD COLUMN IF NOT EXISTS acceptor_confirmed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS creator_data JSONB,
    ADD COLUMN IF NOT EXISTS acceptor_data JSONB;
  `);
  await c.end();
}
run().catch(console.error);
