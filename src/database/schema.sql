-- Instrucciones de creación de base de datos para entornos locales:
-- CREATE DATABASE valora_wallet_db;
-- \c valora_wallet_db;

-- Habilitar extensión para generación de UUIDs v4
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- Tabla de Usuarios
-- Almacena los datos principales de registro, seguridad (hasheo) y perfil.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    phone VARCHAR(20) UNIQUE,
    phone_verificado BOOLEAN DEFAULT false NOT NULL,
    country VARCHAR(5) DEFAULT 'AR' NOT NULL,
    -- Nullable a propósito (igual que phone): las cuentas creadas con Google no traen DU
    -- del alta y quedan sin completar hasta que el usuario lo carga vía PATCH /auth/me.
    -- Postgres permite múltiples NULL en una columna UNIQUE sin problema, así que esto no
    -- debilita la regla de "un DNI, una cuenta" una vez que el valor sí está cargado.
    du VARCHAR(20) UNIQUE,
    password_reset_token_hash VARCHAR(64),
    password_reset_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Tabla de Billeteras (Wallets)
-- Relación 1:1 con el usuario. Cada usuario posee una billetera única.
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cvu VARCHAR(22) UNIQUE NOT NULL,
    alias VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Tabla de Saldos (Balances)
-- Registra los montos disponibles por moneda (USD, EUR, ARS) de la billetera.
CREATE TABLE IF NOT EXISTS balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    currency_code VARCHAR(10) NOT NULL,
    amount NUMERIC(18,8) NOT NULL DEFAULT 0.00000000 CHECK (amount >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_wallet_currency UNIQUE (wallet_id, currency_code)
);

-- Tabla de Transacciones
-- Ledger inmutable que audita compras, ventas e intercambios de divisas.
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'EXCHANGE', 'DEPOSIT')),
    source_currency VARCHAR(10),
    target_currency VARCHAR(10),
    source_amount NUMERIC(18,8),
    target_amount NUMERIC(18,8),
    exchange_rate NUMERIC(18,8),
    resulting_balance NUMERIC(18,8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Índices de Rendimiento
-- Optimizan búsquedas frecuentes por billetera y filtrado en transacciones.
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);

-- Actualizaciones de Esquema (Migraciones de compatibilidad)
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(5) DEFAULT 'AR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS du VARCHAR(20) UNIQUE;
ALTER TABLE users ALTER COLUMN du DROP NOT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS cvu VARCHAR(22) UNIQUE;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS alias VARCHAR(100) UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
-- Por si alguna instalación llegó a crear la tabla con el CREATE TABLE que tenía
-- "du ... NOT NULL" (ver historial): sin este ALTER, esas instalaciones seguirían
-- rechazando el alta con Google (que inserta du = NULL) aunque el CREATE TABLE de
-- arriba ya esté corregido, porque CREATE TABLE IF NOT EXISTS no toca tablas existentes.
-- No-op si la columna ya es nullable (como en Railway y en instalaciones nuevas).
ALTER TABLE users ALTER COLUMN du DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verificado BOOLEAN DEFAULT false NOT NULL;
-- NOTA: a diferencia del resto de las columnas de esta sección, a propósito NO agregamos acá
-- "ALTER TABLE users ADD CONSTRAINT ... UNIQUE (phone)". Hay teléfonos duplicados reales en
-- producción hoy (cuentas de prueba) y ese ALTER fallaría y cortaría el deploy entero, ya que
-- deploy.ts ejecuta este archivo completo como una sola consulta. El UNIQUE en el CREATE TABLE
-- de arriba solo aplica a instalaciones nuevas. Limpiar los duplicados y agregar el constraint
-- acá queda pendiente como tarea aparte.

-- El índice va después del ALTER TABLE que agrega la columna: en una base existente
-- (sin este ALTER todavía aplicado) crear el índice antes rompería todo el deploy,
-- ya que deploy.ts ejecuta este archivo entero como una sola consulta.
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token_hash ON users(password_reset_token_hash);
