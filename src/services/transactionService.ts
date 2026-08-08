import { pool } from "../database/db.js";
import { findWalletByUserId } from "../models/walletModel.js";
import { updateUserBalance } from "../models/balanceModel.js";
import { insertTransaction, findTransactionsByWalletId, countTransactionsByWalletId } from "../models/transactionModel.js";
import { getExchangeRates } from "./exchangeRateService.js";

const MAX_SLIPPAGE = 0.05; // 5% de tolerancia de cambio de precio

/**
 * Executes a deposit transaction securely using ACID properties.
 * @param userId - The user's UUID
 * @param currency - The deposit currency
 * @param amount - The deposit amount
 * @returns The recorded transaction
 */
export async function executeDeposit(userId: string, currency: string, amount: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a depositar debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });

    const wallet = await findWalletByUserId(userId);
    if (!wallet) throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const updatedBalance = await updateUserBalance(client, wallet.id, currency, amount);
        const transaction = await insertTransaction(
            client, wallet.id, "DEPOSIT", null, currency, null, amount, null, updatedBalance.amount
        );

        await client.query("COMMIT");
        return transaction;
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Obtiene una cotización en tiempo real sin abrir conexiones a la base de datos.
 * @param fromCurrency Moneda de origen
 * @param toCurrency Moneda de destino
 * @param amount Monto a convertir
 * @returns Tasa de cambio y monto a recibir
 */
export async function getExchangeQuote(fromCurrency: string, toCurrency: string, amount: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a cotizar debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    if (fromCurrency === toCurrency) throw Object.assign(new Error("Las monedas de origen y destino no pueden ser iguales."), { status: 400, code: "SAME_CURRENCY" });

    const rates = await getExchangeRates();
    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible para las monedas seleccionadas."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const exchangeRate = rateTo / rateFrom;
    const amountInUsd = amount / rateFrom;
    const targetAmount = amountInUsd * rateTo;

    return {
        exchangeRate,
        targetAmount
    };
}

/**
 * Lógica común privada para ejecutar conversiones de moneda (EXCHANGE, BUY, SELL)
 * garantizando ACID y verificando tolerancia a slippage.
 */
async function executeConversion(
    userId: string,
    type: "EXCHANGE" | "BUY" | "SELL",
    fromCurrency: string,
    toCurrency: string,
    amount: number,
    userAcceptedRate: number
) {
    const action = type === "EXCHANGE" ? "intercambiar" : type === "BUY" ? "comprar" : "vender";
    if (amount <= 0) throw Object.assign(new Error(`El monto a ${action} debe ser mayor a cero.`), { status: 400, code: "INVALID_AMOUNT" });
    if (fromCurrency === toCurrency) throw Object.assign(new Error("Las monedas de origen y destino no pueden ser iguales."), { status: 400, code: "SAME_CURRENCY" });

    const wallet = await findWalletByUserId(userId);
    if (!wallet) throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    // Fetch exchange rates from Day 1 service BEFORE acquiring DB connection
    const rates = await getExchangeRates();
    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible para las monedas seleccionadas."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const realRate = rateTo / rateFrom;
    
    // Slippage tolerance check
    if (Math.abs(realRate - userAcceptedRate) / userAcceptedRate > MAX_SLIPPAGE) {
        throw Object.assign(new Error("La tasa de cambio ha variado significativamente. Vuelve a cotizar."), { status: 400, code: "SLIPPAGE_EXCEEDED" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Mathematical logic for exchange
        const amountInUsd = amount / rateFrom;
        const targetAmount = amountInUsd * rateTo;
        const exchangeRate = rateTo / rateFrom;

        // Deduct from source currency (negative amount)
        await updateUserBalance(client, wallet.id, fromCurrency, -amount);
        
        // Add to target currency (positive amount)
        const newTargetBalance = await updateUserBalance(client, wallet.id, toCurrency, targetAmount);

        // Record the operation in the ledger
        const transaction = await insertTransaction(
            client, wallet.id, type, fromCurrency, toCurrency, amount, targetAmount, exchangeRate, newTargetBalance.amount
        );

        await client.query("COMMIT");
        return transaction;
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Executes a currency exchange ensuring sufficient funds and atomic updates.
 * @param userId - The user's UUID
 * @param fromCurrency - Source currency
 * @param toCurrency - Destination currency
 * @param amount - Amount to exchange
 * @param userAcceptedRate - Exchange rate accepted by user for slippage protection
 * @returns The recorded transaction
 */
export async function executeExchange(userId: string, fromCurrency: string, toCurrency: string, amount: number, userAcceptedRate: number) {
    return executeConversion(userId, "EXCHANGE", fromCurrency, toCurrency, amount, userAcceptedRate);
}

/**
 * Executes a currency buy ensuring sufficient funds and atomic updates.
 * @param userId - The user's UUID
 * @param fromCurrency - Source currency (currency spent)
 * @param toCurrency - Destination currency (currency bought)
 * @param amount - Amount to sell/spend
 * @param userAcceptedRate - Exchange rate accepted by user for slippage protection
 * @returns The recorded transaction
 */
export async function executeBuy(userId: string, fromCurrency: string, toCurrency: string, amount: number, userAcceptedRate: number) {
    return executeConversion(userId, "BUY", fromCurrency, toCurrency, amount, userAcceptedRate);
}

/**
 * Executes a currency sell ensuring sufficient funds and atomic updates.
 * @param userId - The user's UUID
 * @param fromCurrency - Source currency (currency sold)
 * @param toCurrency - Destination currency (currency obtained)
 * @param amount - Amount to sell
 * @param userAcceptedRate - Exchange rate accepted by user for slippage protection
 * @returns The recorded transaction
 */
export async function executeSell(userId: string, fromCurrency: string, toCurrency: string, amount: number, userAcceptedRate: number) {
    return executeConversion(userId, "SELL", fromCurrency, toCurrency, amount, userAcceptedRate);
}

/**
 * Recupera el historial de transacciones paginado del usuario.
 * @param userId - UUID del usuario
 * @param limit - Límite de transacciones por página
 * @param page - Número de página actual (1-indexed)
 * @param type - Tipo opcional de transacción a filtrar
 */
export async function getUserTransactions(
    userId: string,
    limit: number = 20,
    page: number = 1,
    type?: string
) {
    const wallet = await findWalletByUserId(userId);
    if (!wallet) {
        throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });
    }

    const offset = (page - 1) * limit;
    const [transactions, totalCount] = await Promise.all([
        findTransactionsByWalletId(wallet.id, limit, offset, type),
        countTransactionsByWalletId(wallet.id, type)
    ]);

    return {
        transactions,
        pagination: {
            page,
            limit,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / limit)
        }
    };
}