import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import type { Transaction } from "../models/transactionModel.js";
import { executeDeposit, executeExchange, getUserTransactions, executeBuy, executeSell, getExchangeQuote } from "../services/transactionService.js";
import type { GetTransactionsQuery } from "../schemas/transactionSchema.js";

/**
 * Maps a database transaction record (snake_case) to an API DTO (camelCase).
 * @param tx - The raw transaction object from the database
 * @returns The mapped object
 */
const mapTransactionToCamelCase = (tx: Transaction) => ({
    id: tx.id,
    walletId: tx.wallet_id,
    transactionType: tx.transaction_type,
    sourceCurrency: tx.source_currency,
    targetCurrency: tx.target_currency,
    sourceAmount: tx.source_amount ? parseFloat(tx.source_amount) : null,
    targetAmount: tx.target_amount ? parseFloat(tx.target_amount) : null,
    exchangeRate: tx.exchange_rate ? parseFloat(tx.exchange_rate) : null,
    resultingBalance: tx.resulting_balance ? parseFloat(tx.resulting_balance) : null,
    createdAt: tx.created_at,
});

/**
 * Controller to handle deposit requests.
 */
export async function depositController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { currency, amount } = req.body;

        if (!userId) {
            res.status(401).json({ success: false, error: "AUTH_ERROR", message: "Usuario no autorizado." });
            return;
        }

        const transaction = await executeDeposit(userId, currency, amount);

        res.status(200).json({
            success: true,
            data: mapTransactionToCamelCase(transaction)
        });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Controller to handle quote requests.
 */
export async function quoteController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { fromCurrency, toCurrency, amount } = req.body;

        if (!userId) {
            res.status(401).json({ success: false, error: "AUTH_ERROR", message: "Usuario no autorizado." });
            return;
        }
        
        const quote = await getExchangeQuote(fromCurrency, toCurrency, amount);

        res.status(200).json({
            success: true,
            data: quote
        });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Controller to handle exchange requests.
 */
export async function exchangeController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { fromCurrency, toCurrency, amount } = req.body;

        if (!userId) {
            res.status(401).json({ success: false, error: "AUTH_ERROR", message: "Usuario no autorizado." });
            return;
        }

        const transaction = await executeExchange(userId, fromCurrency, toCurrency, amount);

        res.status(200).json({
            success: true,
            data: mapTransactionToCamelCase(transaction)
        });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Controlador para obtener el historial de transacciones paginado del usuario.
 */
export async function getTransactionsController(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: "AUTH_ERROR",
                message: "Usuario no autorizado."
            });
            return;
        }

        // Extraer los query params ya validados y parseados por el middleware validateSchema
        const { limit, page, type } = req.validatedQuery as unknown as GetTransactionsQuery;

        const result = await getUserTransactions(userId, limit, page, type);
        const mappedTransactions = result.transactions.map(mapTransactionToCamelCase);

        res.status(200).json({
            success: true,
            data: mappedTransactions,
            pagination: result.pagination
        });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Controller to handle buy requests.
 */
export async function buyController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { fromCurrency, toCurrency, amount } = req.body;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: "AUTH_ERROR",
                message: "Usuario no autorizado."
            });
            return;
        }

        const transaction = await executeBuy(userId, fromCurrency, toCurrency, amount);

        res.status(200).json({
            success: true,
            data: mapTransactionToCamelCase(transaction)
        });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Controller to handle sell requests.
 */
export async function sellController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { fromCurrency, toCurrency, amount } = req.body;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: "AUTH_ERROR",
                message: "Usuario no autorizado."
            });
            return;
        }

        const transaction = await executeSell(userId, fromCurrency, toCurrency, amount);

        res.status(200).json({
            success: true,
            data: mapTransactionToCamelCase(transaction)
        });
    } catch (error: unknown) {
        next(error);
    }
}