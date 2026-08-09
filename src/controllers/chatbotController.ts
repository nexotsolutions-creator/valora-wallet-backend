import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { initializeAndGetBalances } from "../services/balanceService.js";
import { getFinancialAdvice } from "../services/aiService.js";
import { getExchangeRates } from "../services/exchangeRateService.js";

/**
 * Controlador para manejar las consultas al asistente financiero con IA.
 */
export async function chatController(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userId = req.user?.userId;
        const { message, history = [] } = req.body;

        // Validación de seguridad básica
        if (!userId) {
            res.status(401).json({ success: false, error: "AUTH_ERROR", message: "Usuario no autorizado." });
            return;
        }

        // 1. Inyección Contextual: Obtenemos los saldos y cotizaciones reales
        const balances = await initializeAndGetBalances(userId);
        const rates = await getExchangeRates(); // Sin forceFresh, respeta la caché inteligente

        // Formateamos los saldos a un objeto clave-valor simple para la IA (ej: { USD: 100, ARS: 50000 })
        const formattedBalances = balances.reduce((acc, b) => {
            acc[b.currency_code] = parseFloat(b.amount);
            return acc;
        }, {} as Record<string, number>);

        // 2. Consulta a Groq con Timeout de 24s
        const aiPromise = getFinancialAdvice(message, formattedBalances, rates, history);
        
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                const error = Object.assign(new Error("El asistente está tardando demasiado en responder."), {
                    status: 504,
                    code: "TIMEOUT_ERROR"
                });
                reject(error);
            }, 24000);
        });

        const aiResponse = await Promise.race([aiPromise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });

        // 3. Respuesta en formato estandarizado (camelCase)
        res.status(200).json({
            success: true,
            data: {
                reply: aiResponse
            }
        });
    } catch (error: unknown) {
        next(error);
    }
}