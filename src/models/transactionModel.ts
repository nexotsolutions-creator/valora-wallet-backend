import type { PoolClient } from "pg";
import { query } from "../database/db.js";

export interface Transaction {
  id: string;
  wallet_id: string;
  transaction_type: 'BUY' | 'SELL' | 'EXCHANGE' | 'DEPOSIT';
  source_currency: string | null;
  target_currency: string | null;
  source_amount: string | null; // NUMERIC is returned as a string from node-pg to preserve precision
  target_amount: string | null;
  exchange_rate: string | null;
  resulting_balance: string | null;
  created_at: string | Date;
  counterparty_id?: string | null;
  counterparty_name?: string | null;
  counterparty_email?: string | null;
  counterparty_wallet?: string | null;
}

/**
 * Inserts a new transaction record into the database.
 * @param client - The database pool client to ensure transaction atomicity
 * @param walletId - The wallet UUID
 * @param type - The transaction type
 * @param sourceCurrency - The origin currency
 * @param targetCurrency - The destination currency
 * @param sourceAmount - The deducted amount
 * @param targetAmount - The credited amount
 * @param exchangeRate - The applied conversion rate
 * @param resultingBalance - The final balance of the target currency
 * @returns The created transaction record
 */

export async function insertTransaction(
  client: PoolClient,
  walletId: string,
  type: 'BUY' | 'SELL' | 'EXCHANGE' | 'DEPOSIT',
  sourceCurrency: string | null,
  targetCurrency: string | null,
  sourceAmount: number | string | null,
  targetAmount: number | string | null,
  exchangeRate: number | string | null,
  resultingBalance: number | string | null,
  counterpartyId?: string | null,
  counterpartyName?: string | null,
  counterpartyEmail?: string | null,
  counterpartyWallet?: string | null
): Promise<Transaction> {
  const sql = `
    INSERT INTO transactions 
    (wallet_id, transaction_type, source_currency, target_currency, source_amount, target_amount, exchange_rate, resulting_balance, counterparty_id, counterparty_name, counterparty_email, counterparty_wallet)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *;
  `;

  const values = [
    walletId,
    type,
    sourceCurrency,
    targetCurrency,
    sourceAmount?.toString(),
    targetAmount?.toString(),
    exchangeRate?.toString(),
    resultingBalance?.toString(),
    counterpartyId,
    counterpartyName,
    counterpartyEmail,
    counterpartyWallet
  ];

  const result = await client.query(sql, values);
  if (result.rows.length === 0) {
    throw new Error("No se pudo insertar la transacción en la base de datos.");
  }

  const [row] = result.rows;

  return {
    id: row.id,
    wallet_id: row.wallet_id,
    transaction_type: row.transaction_type,
    source_currency: row.source_currency,
    target_currency: row.target_currency,
    source_amount: row.source_amount,
    target_amount: row.target_amount,
    exchange_rate: row.exchange_rate,
    resulting_balance: row.resulting_balance,
    created_at: row.created_at,
    counterparty_id: row.counterparty_id,
    counterparty_name: row.counterparty_name,
    counterparty_email: row.counterparty_email,
    counterparty_wallet: row.counterparty_wallet
  } satisfies Transaction;
}

/**
 * Recupera el historial de transacciones asociadas a una billetera específica.
 * @param walletId El UUID de la billetera.
 * @param limit Límite máximo de resultados (por defecto 20).
 * @param offset Desplazamiento para paginación (por defecto 0).
 * @param type Filtro opcional por tipo de transacción.
 * @returns Listado de transacciones que coinciden con los criterios de búsqueda.
 */
export async function findTransactionsByWalletId(
  walletId: string,
  limit: number = 20,
  offset: number = 0,
  type?: string
): Promise<Transaction[]> {
  const values: unknown[] = [walletId];
  let sql = `
    SELECT id, wallet_id, transaction_type, source_currency, target_currency, source_amount, target_amount, exchange_rate, resulting_balance, created_at, counterparty_id, counterparty_name, counterparty_email, counterparty_wallet
    FROM transactions
    WHERE wallet_id = $1
  `;

  if (type) {
    values.push(type);
    sql += ` AND transaction_type = $${values.length}`;
  }

  sql += ` ORDER BY created_at DESC`;

  values.push(limit);
  sql += ` LIMIT $${values.length}`;

  values.push(offset);
  sql += ` OFFSET $${values.length}`;

  const result = await query(sql, values);
  return result.rows as Transaction[];
}

/**
 * Cuenta el total de transacciones asociadas a una billetera específica.
 * @param walletId El UUID de la billetera.
 * @param type Filtro opcional por tipo de transacción.
 * @returns La cantidad total de transacciones.
 */
export async function countTransactionsByWalletId(
  walletId: string,
  type?: string
): Promise<number> {
  const values: unknown[] = [walletId];
  let sql = `SELECT COUNT(*) FROM transactions WHERE wallet_id = $1`;

  if (type) {
    values.push(type);
    sql += ` AND transaction_type = $${values.length}`;
  }

  const result = await query(sql, values);
  return parseInt(result.rows[0].count, 10);
}