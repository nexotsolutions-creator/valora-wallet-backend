import { pool } from "../database/db.js";
import { findWalletByUserId } from "../models/walletModel.js";
import { updateUserBalance } from "../models/balanceModel.js";
import { insertTransaction, findTransactionsByWalletId, countTransactionsByWalletId } from "../models/transactionModel.js";
import { getExchangeRates } from "./exchangeRateService.js";
import { enviarEmailConfirmacion } from "./sesService.js";
import { findUserById } from "../models/userModel.js";

function sanitizeHtmlString(input: string): string {
    return input.replace(/[<&>"']/g, "");
}

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

        // Disparar email asíncrono
        void findUserById(userId).then(user => {
            if (user) {
                const safeCurrency = sanitizeHtmlString(currency);
                enviarEmailConfirmacion({
                    destinatario: user.email,
                    asunto: "Depósito Confirmado - Valora Wallet",
                    cuerpoHtml: `<h1>Depósito Exitoso</h1><p>Has depositado ${amount} ${safeCurrency} en tu billetera.</p>`
                }).catch(err => console.error("Error enviando email SES:", err));
            }
        }).catch(err => console.error("Error buscando usuario para email:", err));

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

    type BaseCurrency = "USD" | "EUR" | "ARS";
    const isValidCurrency = (cur: string): cur is BaseCurrency => ["USD", "EUR", "ARS"].includes(cur);

    if (!isValidCurrency(fromCurrency) || !isValidCurrency(toCurrency)) {
        throw Object.assign(new Error("Moneda no soportada para cotización."), { status: 400, code: "UNSUPPORTED_CURRENCY" });
    }

    const rates = await getExchangeRates();
    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo) || rateFrom <= 0 || rateTo <= 0) {
        throw Object.assign(new Error("Tasa de cambio no disponible para las monedas seleccionadas."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    //Redondeo de los numeros
    const exchangeRate = Number((rateTo / rateFrom).toFixed(8));
    const amountInUsd = amount / rateFrom;
    const targetAmount = Number((amountInUsd * rateTo).toFixed(8));

    return {
        exchangeRate,
        targetAmount
    };
}

/**
 * Lógica común privada para ejecutar conversiones de moneda (EXCHANGE, BUY, SELL)
 * garantizando ACID y evitando retener conexiones de base de datos durante llamadas de red externas.
 */
async function executeConversion(
    userId: string,
    type: "EXCHANGE" | "BUY" | "SELL",
    fromCurrency: string,
    toCurrency: string,
    amount: number
) {
    const action = type === "EXCHANGE" ? "intercambiar" : type === "BUY" ? "comprar" : "vender";
    if (amount <= 0) throw Object.assign(new Error(`El monto a ${action} debe ser mayor a cero.`), { status: 400, code: "INVALID_AMOUNT" });
    if (fromCurrency === toCurrency) throw Object.assign(new Error("Las monedas de origen y destino no pueden ser iguales."), { status: 400, code: "SAME_CURRENCY" });

    const wallet = await findWalletByUserId(userId);
    if (!wallet) throw Object.assign(new Error("Billetera no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    type BaseCurrency = "USD" | "EUR" | "ARS";
    const isValidCurrency = (cur: string): cur is BaseCurrency => ["USD", "EUR", "ARS"].includes(cur);

    if (!isValidCurrency(fromCurrency) || !isValidCurrency(toCurrency)) {
        throw Object.assign(new Error("Moneda no soportada para conversión."), { status: 400, code: "UNSUPPORTED_CURRENCY" });
    }

    // Fetch exchange rates from Day 1 service BEFORE acquiring DB connection
    const rates = await getExchangeRates();
    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    // Validar que existan las tasas, que correspondan a valores numéricos finitos y sean mayores a cero
    if (
        !Number.isFinite(rateFrom) ||
        !Number.isFinite(rateTo) ||
        rateFrom <= 0 ||
        rateTo <= 0
    ) {
        throw Object.assign(new Error("Tasa de cambio no disponible para las monedas seleccionadas."), { status: 400, code: "RATE_NOT_AVAILABLE" });
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

        // Disparar email asíncrono
        void findUserById(userId).then(user => {
            if (user) {
                const actionName = type === "EXCHANGE" ? "Intercambio" : type === "BUY" ? "Compra" : "Venta";
                const safeFrom = sanitizeHtmlString(fromCurrency);
                const safeTo = sanitizeHtmlString(toCurrency);
                const timestamp = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
                enviarEmailConfirmacion({
                    destinatario: user.email,
                    asunto: `${actionName} Confirmada - Valora Wallet`,
                    cuerpoHtml: `<h1>${actionName} Exitosa</h1><p>Operación: ${amount} ${safeFrom} por ${targetAmount.toFixed(2)} ${safeTo}</p><p>Fecha y hora: ${timestamp}</p>`
                }).catch(err => console.error("Error enviando email SES:", err));
            }
        }).catch(err => console.error("Error buscando usuario para email:", err));

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
 * @returns The recorded transaction
 */
export async function executeExchange(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "EXCHANGE", fromCurrency, toCurrency, amount);
}

/**
 * Executes a currency buy ensuring sufficient funds and atomic updates.
 * @param userId - The user's UUID
 * @param fromCurrency - Source currency (currency spent)
 * @param toCurrency - Destination currency (currency bought)
 * @param amount - Amount to sell/spend
 * @returns The recorded transaction
 */
export async function executeBuy(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "BUY", fromCurrency, toCurrency, amount);
}

/**
 * Executes a currency sell ensuring sufficient funds and atomic updates.
 * @param userId - The user's UUID
 * @param fromCurrency - Source currency (currency sold)
 * @param toCurrency - Destination currency (currency obtained)
 * @param amount - Amount to sell
 * @returns The recorded transaction
 */
export async function executeSell(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "SELL", fromCurrency, toCurrency, amount);
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