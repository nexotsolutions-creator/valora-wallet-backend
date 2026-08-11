import type { PoolClient } from "pg";
import { query } from "../database/db";

export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: Date | string | null;
  phone: string | null;
  country: string;
  du: string | null;
  // Opcionales: solo los devuelven las queries que explícitamente los seleccionan
  // (createUser/findUserByEmail/findUserById excluyen explícitamente estos tokens/hashes por seguridad).
  password_reset_token_hash?: string | null;
  password_reset_expires_at?: Date | string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * Creates a new user in the database.
 * @param email - User email address
 * @param passwordHash - Hashed password
 * @param firstName - User's first name
 * @param lastName - User's last name
 * @param client - Optional database client for transaction support
 * @returns The newly created user object.
 */
export async function createUser(
  email: string,
  passwordHash: string | null,
  firstName: string,
  lastName: string,
  dateOfBirth: string | null,
  phone: string | null,
  country: string,
  du: string | null,
  client?: PoolClient
): Promise<User> {
  const sql = `
    INSERT INTO users (email, password_hash, first_name, last_name, date_of_birth, phone, country, du)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, email, password_hash, first_name, last_name, date_of_birth, phone, country, du, created_at, updated_at
  `;
  const result = client
    ? await client.query(sql, [email, passwordHash, firstName, lastName, dateOfBirth, phone, country, du])
    : await query(sql, [email, passwordHash, firstName, lastName, dateOfBirth, phone, country, du]);
  if (result.rows.length === 0) {
    throw new Error("No se pudo registrar el usuario en la base de datos.");
  }
  return result.rows[0];
}

/**
 * Completa (o edita) celular, país y DU de un usuario ya existente — usado para el flujo
 * de cuentas de Google, que no piden estos datos en el alta.
 * @param userId - User UUID
 * @param phone - Celular en formato E.164
 * @param country - Código ISO 3166-1 alpha-2
 * @param du - Documento único, normalizado
 * @returns The updated user object, or null si el userId no corresponde a ningún usuario
 * (ej. token válido de una cuenta borrada mientras tanto) — igual que findUserById.
 */
export async function updateUserProfile(
  userId: string,
  phone: string,
  country: string,
  du: string
): Promise<User | null> {
  const sql = `
    UPDATE users
    SET phone = $1, country = $2, du = $3, updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING id, email, password_hash, first_name, last_name, date_of_birth, phone, country, du, created_at, updated_at
  `;
  const result = await query(sql, [phone, country, du, userId]);
  return result.rows[0] || null;
}

/**
 * Finds a user by their unique database ID.
 * @param id - User UUID
 * @returns The user object if found, or null otherwise.
 */
export async function findUserById(id: string): Promise<User | null> {
  const sql = `
    SELECT id, email, password_hash, first_name, last_name, date_of_birth, phone, country, du, created_at, updated_at
    FROM users
    WHERE id = $1
  `;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Finds a user by their unique email address.
 * @param email - User email address
 * @returns The user object if found, or null otherwise.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const sql = `
    SELECT id, email, password_hash, first_name, last_name, date_of_birth, phone, country, du, created_at, updated_at
    FROM users
    WHERE email = $1
  `;
  const result = await query(sql, [email]);
  return result.rows[0] || null;
}

/**
 * Stores a hashed password reset token and its expiration for a user, overwriting any previous one.
 * @param userId - User UUID
 * @param tokenHash - SHA-256 hash of the raw reset token (never store the raw token)
 * @param expiresAt - Expiration timestamp for the token
 */
export async function setPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  const sql = `
    UPDATE users
    SET password_reset_token_hash = $1, password_reset_expires_at = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `;
  await query(sql, [tokenHash, expiresAt, userId]);
}

/**
 * Atomically validates a password reset token and updates the password in a single UPDATE,
 * so the token can't be reused by a second concurrent request racing against the first
 * (the WHERE clause re-checks the token on each attempt, and Postgres serializes concurrent
 * updates to the same row — once one clears the token, the other's WHERE no longer matches).
 * @param tokenHash - SHA-256 hash of the raw reset token
 * @param passwordHash - New hashed password
 * @returns true if a matching, non-expired token was found and the password was updated.
 */
export async function resetPasswordWithValidToken(
  tokenHash: string,
  passwordHash: string
): Promise<boolean> {
  const sql = `
    UPDATE users
    SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE password_reset_token_hash = $2 AND password_reset_expires_at > NOW()
  `;
  const result = await query(sql, [passwordHash, tokenHash]);
  return (result.rowCount ?? 0) > 0;
}
