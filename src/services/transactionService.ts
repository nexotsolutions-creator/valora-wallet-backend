import { pool } from "../database/db.js";
import { findWalletByUserId } from "../models/walletModel.js";
import { updateUserBalance } from "../models/balanceModel.js";
import { insertTransaction, findTransactionsByWalletId, countTransactionsByWalletId } from "../models/transactionModel.js";
import { getExchangeRates } from "./exchangeRateService.js";
import Decimal from "decimal.js";

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
 * Obtiene una cotización para intercambiar monedas.
 * @param fromCurrency Moneda de origen
 * @param toCurrency Moneda de destino
 * @param amount Monto a gastar
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

    const amountInUsd = amount / rateFrom;
    const targetAmount = amountInUsd * rateTo;
    const rateFromTo = rateTo / rateFrom;
    const rateToFrom = rateFrom / rateTo;

    return {
        targetAmount,
        rateFromTo,
        rateToFrom
    };
}

/**
 * Obtiene una cotización para comprar monedas extranjeras pagando externamente (referencia ARS).
 * @param currency Moneda extranjera a comprar
 * @param amount Monto de moneda extranjera que se desea comprar
 */
export async function getBuyQuote(currency: string, amount: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a cotizar debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    if (currency === "ARS") throw Object.assign(new Error("No puedes comprar ARS en este endpoint."), { status: 400, code: "SAME_CURRENCY" });

    const rates = await getExchangeRates();
    const rateFrom = rates["ARS"];
    const rateTo = rates[currency];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const exchangeRate = rateFrom / rateTo;
    const totalCostInARS = amount * exchangeRate;

    return {
        totalCostInARS,
        exchangeRate
    };
}

/**
 * Obtiene una cotización para liquidar monedas extranjeras a ARS.
 * @param currency Moneda extranjera a vender
 * @param amount Monto de moneda extranjera que se desea vender
 */
export async function getSellQuote(currency: string, amount: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a cotizar debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    if (currency === "ARS") throw Object.assign(new Error("No puedes vender ARS en este endpoint."), { status: 400, code: "SAME_CURRENCY" });

    const rates = await getExchangeRates();
    const rateFrom = rates[currency];
    const rateTo = rates["ARS"];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const exchangeRate = rateTo / rateFrom;
    const totalReturnInARS = amount * exchangeRate;

    return {
        totalReturnInARS,
        exchangeRate
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

    const rateFromDec = new Decimal(rateFrom);
    const rateToDec = new Decimal(rateTo);
    const realRateDec = rateToDec.dividedBy(rateFromDec);
    const realRate = realRateDec.toNumber();
    
    // Slippage tolerance check
    if (Math.abs(realRate - userAcceptedRate) / userAcceptedRate > MAX_SLIPPAGE) {
        throw Object.assign(new Error("La tasa de cambio ha variado significativamente. Vuelve a cotizar."), { status: 400, code: "SLIPPAGE_EXCEEDED" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Mathematical logic for exchange
        const amountInUsdDec = new Decimal(amount).dividedBy(rateFromDec);
        const targetAmount = amountInUsdDec.times(rateToDec);
        const exchangeRate = realRate;

        // Deduct from source currency (negative amount)
        await updateUserBalance(client, wallet.id, fromCurrency, -amount);
        
        // Add to target currency (positive amount)
        const newTargetBalance = await updateUserBalance(client, wallet.id, toCurrency, targetAmount);

        // Record the operation in the ledger
        const transaction = await insertTransaction(
            client, wallet.id, type, fromCurrency, toCurrency, amount, targetAmount.toNumber(), exchangeRate, newTargetBalance.amount
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
 * Ejecuta una compra de moneda con tarjeta externa.
 * No se descuenta saldo de la billetera local (ARS) ya que se fondea externamente.
 * @param userId - El UUID del usuario
 * @param currency - La moneda que se desea comprar (USD o EUR)
 * @param amount - Cantidad de moneda a comprar
 * @param userAcceptedRate - Tasa aceptada por el usuario (costo de 1 currency en ARS)
 */
export async function executeBuy(userId: string, currency: string, amount: number, userAcceptedRate: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a comprar debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    if (currency === "ARS") throw Object.assign(new Error("No puedes comprar ARS con ARS."), { status: 400, code: "SAME_CURRENCY" });

    const wallet = await findWalletByUserId(userId);
    if (!wallet) throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    const rates = await getExchangeRates();
    const rateFrom = rates["ARS"];
    const rateTo = rates[currency];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const rateFromDec = new Decimal(rateFrom);
    const rateToDec = new Decimal(rateTo);
    const realRateDec = rateFromDec.dividedBy(rateToDec); // Cuántos ARS por 1 unidad extranjera
    const realRate = realRateDec.toNumber();

    if (Math.abs(realRate - userAcceptedRate) / userAcceptedRate > MAX_SLIPPAGE) {
        throw Object.assign(new Error("La tasa de cambio ha variado significativamente. Vuelve a cotizar."), { status: 400, code: "SLIPPAGE_EXCEEDED" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Sumar moneda extranjera comprada
        const newTargetBalance = await updateUserBalance(client, wallet.id, currency, amount);

        // Guardamos source_amount como null, ya que el cobro es externo
        const transaction = await insertTransaction(
            client, wallet.id, "BUY", null, currency, null, amount, realRate, newTargetBalance.amount
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
 * Ejecuta una venta de moneda para liquidarla en ARS.
 * @param userId - El UUID del usuario
 * @param currency - La moneda que se desea vender (USD o EUR)
 * @param amount - Cantidad de moneda a vender
 * @param userAcceptedRate - Tasa aceptada por el usuario (cuántos ARS le dan por 1 currency)
 */
export async function executeSell(userId: string, currency: string, amount: number, userAcceptedRate: number) {
    if (amount <= 0) throw Object.assign(new Error("El monto a vender debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    if (currency === "ARS") throw Object.assign(new Error("No puedes vender ARS a ARS."), { status: 400, code: "SAME_CURRENCY" });

    const wallet = await findWalletByUserId(userId);
    if (!wallet) throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    const rates = await getExchangeRates();
    const rateFrom = rates[currency];
    const rateTo = rates["ARS"];

    if (!rateFrom || !rateTo) {
        throw Object.assign(new Error("Tasa de cambio no disponible."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const rateFromDec = new Decimal(rateFrom);
    const rateToDec = new Decimal(rateTo);
    const realRateDec = rateToDec.dividedBy(rateFromDec); // Cuántos ARS por 1 unidad extranjera
    const realRate = realRateDec.toNumber();

    if (Math.abs(realRate - userAcceptedRate) / userAcceptedRate > MAX_SLIPPAGE) {
        throw Object.assign(new Error("La tasa de cambio ha variado significativamente. Vuelve a cotizar."), { status: 400, code: "SLIPPAGE_EXCEEDED" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const targetAmount = new Decimal(amount).times(realRateDec); // Total en ARS a recibir

        // Restar moneda extranjera
        await updateUserBalance(client, wallet.id, currency, -amount);
        
        // Sumar ARS
        const newTargetBalance = await updateUserBalance(client, wallet.id, "ARS", targetAmount);

        const transaction = await insertTransaction(
            client, wallet.id, "SELL", currency, "ARS", amount, targetAmount.toNumber(), realRate, newTargetBalance.amount
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