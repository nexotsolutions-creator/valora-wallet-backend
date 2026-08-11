import { pool } from "../database/db.js";
import { findWalletByUserId, findWalletAndUserByIdentifier } from "../models/walletModel.js";
import { updateUserBalance } from "../models/balanceModel.js";
import { insertTransaction, findTransactionsByWalletId, countTransactionsByWalletId } from "../models/transactionModel.js";
import { getExchangeRates } from "./exchangeRateService.js";
import { enviarEmailConfirmacion } from "./sesService.js";
import { findUserById } from "../models/userModel.js";

// ============================================================================
// HELPERS Y UTILIDADES (DRY)
// ============================================================================

function sanitizeHtmlString(input: string): string {
    return input.replace(/[<&>"']/g, "");
}

/**
 * Notificador asíncrono centralizado (Fire-and-Forget).
 * No bloquea la respuesta HTTP ni la base de datos.
 */
function notifyUserAsync(userId: string, subject: string, htmlBody: string): void {
    void findUserById(userId)
        .then(user => {
            if (user) {
                return enviarEmailConfirmacion({
                    destinatario: user.email,
                    asunto: subject,
                    cuerpoHtml: htmlBody
                });
            }
        })
        .catch(err => console.error(`[Background Notification Error] userId ${userId}:`, err));
}

// ============================================================================
// CORE SERVICES
// ============================================================================

/**
 * Executes a deposit transaction securely using ACID properties.
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

        const safeCurrency = sanitizeHtmlString(currency);
        notifyUserAsync(userId, "Depósito Confirmado - Valora Wallet", `<h1>Depósito Exitoso</h1><p>Has depositado ${amount} ${safeCurrency} en tu billetera.</p>`);

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

    const exchangeRate = Number((rateTo / rateFrom).toFixed(8));
    const amountInUsd = amount / rateFrom;
    const targetAmount = Number((amountInUsd * rateTo).toFixed(8));

    return { exchangeRate, targetAmount };
}

/**
 * Lógica común privada para ejecutar conversiones de moneda (EXCHANGE, BUY, SELL)
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

    const rates = await getExchangeRates();
    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo) || rateFrom <= 0 || rateTo <= 0) {
        throw Object.assign(new Error("Tasa de cambio no disponible para las monedas seleccionadas."), { status: 400, code: "RATE_NOT_AVAILABLE" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // FIX: Sincronización matemática idéntica a getExchangeQuote (8 decimales)
        const exchangeRate = Number((rateTo / rateFrom).toFixed(8));
        const amountInUsd = amount / rateFrom;
        const targetAmount = Number((amountInUsd * rateTo).toFixed(8));

        await updateUserBalance(client, wallet.id, fromCurrency, -amount);
        const newTargetBalance = await updateUserBalance(client, wallet.id, toCurrency, targetAmount);

        const transaction = await insertTransaction(
            client, wallet.id, type, fromCurrency, toCurrency, amount, targetAmount, exchangeRate, newTargetBalance.amount
        );

        await client.query("COMMIT");

        const actionName = type === "EXCHANGE" ? "Intercambio" : type === "BUY" ? "Compra" : "Venta";
        const safeFrom = sanitizeHtmlString(fromCurrency);
        const safeTo = sanitizeHtmlString(toCurrency);
        const timestamp = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
        
        notifyUserAsync(userId, `${actionName} Confirmada - Valora Wallet`, `<h1>${actionName} Exitosa</h1><p>Operación: ${amount} ${safeFrom} por ${targetAmount} ${safeTo}</p><p>Fecha y hora: ${timestamp}</p>`);

        return transaction;
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function executeExchange(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "EXCHANGE", fromCurrency, toCurrency, amount);
}

export async function executeBuy(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "BUY", fromCurrency, toCurrency, amount);
}

export async function executeSell(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    return executeConversion(userId, "SELL", fromCurrency, toCurrency, amount);
}

/**
 * Recupera el historial de transacciones paginado del usuario.
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

/**
 * Resuelve el destino de una transferencia basándose en un email, alias o CVU.
 */
export async function resolveTransferDestination(identifier: string) {
    const destination = await findWalletAndUserByIdentifier(identifier);
    if (!destination) {
        throw Object.assign(new Error("No existe un usuario con estos datos."), { status: 404, code: "USER_NOT_FOUND" });
    }
    return destination;
}

/**
 * Ejecuta una transferencia de fondos de un usuario a otro.
 */
export async function executeTransfer(senderUserId: string, currency: string, amount: number, destinationIdentifier: string) {
    if (amount <= 0) throw Object.assign(new Error("El monto a transferir debe ser mayor a cero."), { status: 400, code: "INVALID_AMOUNT" });
    
    const senderWallet = await findWalletByUserId(senderUserId);
    if (!senderWallet) throw Object.assign(new Error("Billetera de origen no encontrada."), { status: 404, code: "WALLET_NOT_FOUND" });

    const senderUser = await findUserById(senderUserId);
    if (!senderUser) throw Object.assign(new Error("Usuario de origen no encontrado."), { status: 404, code: "USER_NOT_FOUND" });

    const recipientInfo = await findWalletAndUserByIdentifier(destinationIdentifier);
    if (!recipientInfo) throw Object.assign(new Error("No existe un usuario con estos datos."), { status: 404, code: "USER_NOT_FOUND" });

    if (senderWallet.id === recipientInfo.wallet_id) {
        throw Object.assign(new Error("No puedes transferir fondos a tu propia cuenta."), { status: 400, code: "SELF_TRANSFER" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Bloqueo determinístico para prevenir Deadlocks en transferencias concurrentes.
        // NOTA ARQUITECTÓNICA: Se usa [[id1, id2]] intencionalmente. El driver 'pg' requiere que 
        // el parámetro $1 (el array de UUIDs) esté encapsulado en el índice 0 del array de 'values'.
        // Si usamos [id1, id2] sin anidar, pg asignaría $1=id1 y $2=id2, rompiendo la consulta.
        await client.query(
            `SELECT id FROM wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
            [[senderWallet.id, recipientInfo.wallet_id]]
        );

        let senderUpdatedBalance;
        try {
            senderUpdatedBalance = await updateUserBalance(client, senderWallet.id, currency, -amount);
        } catch (error: unknown) { // FIX: Eliminado el "any" inseguro
            // Validación segura del error sin usar "any"
            if (error instanceof Error && "constraint" in error && error.constraint === "balances_amount_check") {
                throw Object.assign(new Error("No se puede realizar la transacción, saldo insuficiente."), { status: 400, code: "INSUFFICIENT_FUNDS" });
            }
            if (error instanceof Error && error.message.includes("violates check constraint")) {
                throw Object.assign(new Error("No se puede realizar la transacción, saldo insuficiente."), { status: 400, code: "INSUFFICIENT_FUNDS" });
            }
            throw error;
        }

        const recipientUpdatedBalance = await updateUserBalance(client, recipientInfo.wallet_id, currency, amount);

        const senderTransaction = await insertTransaction(
            client, senderWallet.id, "TRANSFER_OUT", currency, currency, amount, null, null, senderUpdatedBalance.amount,
            recipientInfo.user_id, recipientInfo.first_name, recipientInfo.last_name, recipientInfo.email, recipientInfo.wallet_id
        );

        await insertTransaction(
            client, recipientInfo.wallet_id, "TRANSFER_IN", currency, currency, null, amount, null, recipientUpdatedBalance.amount,
            senderUserId, senderUser.first_name, senderUser.last_name, senderUser.email, senderWallet.id
        );

        await client.query("COMMIT");

        notifyUserAsync(senderUserId, "Transferencia Enviada - Valora Wallet", `<h1>Transferencia Exitosa</h1><p>Has enviado ${amount} ${sanitizeHtmlString(currency)} a ${sanitizeHtmlString(recipientInfo.first_name)} ${sanitizeHtmlString(recipientInfo.last_name)}.</p>`);
        notifyUserAsync(recipientInfo.user_id, "Transferencia Recibida - Valora Wallet", `<h1>Has recibido una transferencia</h1><p>Has recibido ${amount} ${sanitizeHtmlString(currency)}.</p>`);

        return senderTransaction;
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}