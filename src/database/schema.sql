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
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Tabla de Billeteras (Wallets)
-- Relación 1:1 con el usuario. Cada usuario posee una billetera única.
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Soporte para P2P (Escrow y Contraparte)
ALTER TABLE balances ADD COLUMN IF NOT EXISTS locked_amount NUMERIC(18,8) NOT NULL DEFAULT 0.00000000 CHECK (locked_amount >= 0);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(100);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_email VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_wallet UUID REFERENCES wallets(id) ON DELETE SET NULL;

-- Tabla de Solicitudes P2P (Marketplace y Negociación)
CREATE TABLE IF NOT EXISTS p2p_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acceptor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    currency_from VARCHAR(10) NOT NULL,
    currency_to VARCHAR(10) NOT NULL,
    type VARCHAR(4) NOT NULL CHECK (type IN ('BUY', 'SELL')),
    amount NUMERIC(18,8) NOT NULL CHECK (amount > 0),
    exchange_rate NUMERIC(18,8) NOT NULL CHECK (exchange_rate > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'NEGOTIATING', 'LOCKED', 'COMPLETED', 'FAILED', 'DROPPED')),
    creator_confirmed BOOLEAN DEFAULT false,
    acceptor_confirmed BOOLEAN DEFAULT false,
    creator_data JSONB,
    acceptor_data JSONB,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
