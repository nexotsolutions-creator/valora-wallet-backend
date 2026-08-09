import type { PoolClient } from "pg";
import { query } from "../database/db.js";

export interface P2PRequest {
  id: string;
  creator_id: string;
  acceptor_id: string | null;
  type: 'BUY' | 'SELL';
  currency_from: string;
  currency_to: string;
  amount: string;
  exchange_rate: string;
  status: 'PENDING' | 'NEGOTIATING' | 'LOCKED' | 'COMPLETED' | 'FAILED' | 'DROPPED';
  creator_confirmed: boolean;
  acceptor_confirmed: boolean;
  creator_data: any | null;
  acceptor_data: any | null;
  expires_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export async function createP2PRequest(
  client: PoolClient,
  creatorId: string,
  type: 'BUY' | 'SELL',
  currencyFrom: string,
  currencyTo: string,
  amount: number | string,
  exchangeRate: number | string
): Promise<P2PRequest> {
  const sql = `
    INSERT INTO p2p_requests (creator_id, type, currency_from, currency_to, amount, exchange_rate, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
    RETURNING *;
  `;
  const result = await client.query(sql, [creatorId, type, currencyFrom, currencyTo, amount.toString(), exchangeRate.toString()]);
  return result.rows[0];
}

export async function getP2PRequestById(id: string, client?: PoolClient, forUpdate: boolean = false): Promise<P2PRequest | null> {
  const sql = `SELECT * FROM p2p_requests WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`;
  const result = client ? await client.query(sql, [id]) : await query(sql, [id]);
  return result.rows[0] || null;
}

export async function getMarketplaceRequests(): Promise<P2PRequest[]> {
  const sql = `SELECT * FROM p2p_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 50`;
  const result = await query(sql);
  return result.rows;
}

export async function updateP2PRequestStatus(
  client: PoolClient,
  id: string,
  status: string,
  acceptorId?: string | null,
  amount?: string | number,
  exchangeRate?: string | number,
  expiresAt?: Date | null,
  creatorConfirmed?: boolean,
  acceptorConfirmed?: boolean,
  creatorData?: any,
  acceptorData?: any
): Promise<P2PRequest> {
  const updates: string[] = ["status = $2", "updated_at = CURRENT_TIMESTAMP"];
  const values: any[] = [id, status];
  
  let index = 3;
  if (acceptorId !== undefined) {
    updates.push(`acceptor_id = $${index++}`);
    values.push(acceptorId);
  }
  if (amount !== undefined) {
    updates.push(`amount = $${index++}`);
    values.push(amount.toString());
  }
  if (exchangeRate !== undefined) {
    updates.push(`exchange_rate = $${index++}`);
    values.push(exchangeRate.toString());
  }
  if (expiresAt !== undefined) {
    updates.push(`expires_at = $${index++}`);
    values.push(expiresAt);
  }
  if (creatorConfirmed !== undefined) {
    updates.push(`creator_confirmed = $${index++}`);
    values.push(creatorConfirmed);
  }
  if (acceptorConfirmed !== undefined) {
    updates.push(`acceptor_confirmed = $${index++}`);
    values.push(acceptorConfirmed);
  }
  if (creatorData !== undefined) {
    updates.push(`creator_data = $${index++}`);
    values.push(creatorData);
  }
  if (acceptorData !== undefined) {
    updates.push(`acceptor_data = $${index++}`);
    values.push(acceptorData);
  }

  const sql = `
    UPDATE p2p_requests 
    SET ${updates.join(", ")}
    WHERE id = $1
    RETURNING *;
  `;
  
  const result = await client.query(sql, values);
  if (result.rows.length === 0) {
    throw new Error("No se pudo actualizar la solicitud P2P.");
  }
  return result.rows[0];
}

export async function getExpiredLockedRequests(client?: PoolClient): Promise<P2PRequest[]> {
  const sql = `
    SELECT * FROM p2p_requests 
    WHERE status = 'LOCKED' AND expires_at < CURRENT_TIMESTAMP
  `;
  const result = client ? await client.query(sql) : await query(sql);
  return result.rows;
}
