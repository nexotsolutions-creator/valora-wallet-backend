import "dotenv/config";
import { pool } from "./db.js";

interface SeedUser {
  id: string;
  email: string;
  first_name: string;
}

/** Poblar la base de datos con cuentas demo para la presentación. */
async function seed(): Promise<void> {
  console.log("🌱 Iniciando seed de datos...");
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(`DELETE FROM users WHERE email LIKE 'demo.%@valora.com'`);

    const { rows: users, rowCount } = await client.query<SeedUser>(`
      INSERT INTO users (email, first_name, last_name, country)
      VALUES 
        ('demo.juan@valora.com',   'Juan',   'Pérez', 'AR'),
        ('demo.maria@valora.com',  'Maria',  'Gómez', 'CO'),
        ('demo.carlos@valora.com', 'Carlos', 'López', 'MX')
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, first_name;
    `);

    if (rowCount === 0) {
      console.log("⚠️  Los usuarios demo ya existen. Ejecutá con una base limpia.");
      await client.query("ROLLBACK");
      return;
    }

    console.log(`✅ Creados ${rowCount} usuarios.`);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const cvu = `0000${String(i + 1).padStart(18, "0")}`;
      const alias = `demo.${user.first_name.toLowerCase()}.valora`;

      const { rows: walletRows } = await client.query(`
        INSERT INTO wallets (user_id, cvu, alias)
        VALUES ($1, $2, $3)
        RETURNING id;
      `, [user.id, cvu, alias]);

      const walletId = walletRows[0].id;

      // Consistencia matemática: balance inicial USD (3900.00) = 5000.00 (BUY) - 1100.00 (EXCHANGE)
      await client.query(`
        INSERT INTO balances (wallet_id, currency_code, amount)
        VALUES 
          ($1, 'USD', 3900.00),
          ($1, 'ARS', 150000.00),
          ($1, 'EUR', 1000.00)
      `, [walletId]);

      await client.query(`
        INSERT INTO transactions
          (wallet_id, transaction_type, source_currency, target_currency,
           source_amount, target_amount, exchange_rate, resulting_balance, created_at)
        VALUES 
          ($1, 'DEPOSIT',  NULL,  'ARS', NULL,      250000.00, 1.0,    250000.00, NOW() - INTERVAL '5 days'),
          ($1, 'BUY',      'ARS', 'USD', 100000.00, 5000.00,   20.00,  5000.00,   NOW() - INTERVAL '3 days'),
          ($1, 'EXCHANGE', 'USD', 'EUR', 1100.00,   1000.00,   0.9091, 1000.00,   NOW() - INTERVAL '2 days')
      `, [walletId]);

      console.log(`💰 Billetera, saldos e historial creados para ${user.email}`);
    }

    await client.query("COMMIT");
    console.log("🚀 Seed finalizado con éxito.");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
    }
    console.error("❌ Error ejecutando seed (ROLLBACK aplicado si corresponde):", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

seed();
