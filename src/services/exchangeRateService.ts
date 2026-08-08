interface ExchangeApiResponse {
    amount?: number;
    base?: string;
    date?: string;
    rates: Record<string, number>;
}

interface ExchangeRateCacheState {
    rates: Record<string, number>;
    fetchedAt: number;
}

let ratesCache: ExchangeRateCacheState | null = null;

// Constante de tiempo: 1 hora en milisegundos
const CACHE_TTL = 60 * 60 * 1000;

export async function getExchangeRates(): Promise<Record<string, number>> {
    const now = Date.now();

    // 1. Devolver caché fresca si es válida
    if (ratesCache && (now - ratesCache.fetchedAt) < CACHE_TTL) {
        return ratesCache.rates;
    }

    try {
        // 2. Proveedor Principal (Frankfurter)
        const response = await fetch("https://api.frankfurter.app/latest?from=USD");
        if (!response.ok) {
            throw new Error(`Frankfurter respondió con estado ${response.status}`);
        }

        const data = (await response.json()) as ExchangeApiResponse;
        return procesarYGuardarCache(data.rates);

    } catch (primaryError: unknown) {
        console.warn(`[Exchange Service] Proveedor principal falló. Iniciando Fallback... (${(primaryError as Error).message})`);

        try {
            // 3. Proveedor de Respaldo (ExchangeRate-API)
            const fallbackResponse = await fetch("https://open.er-api.com/v6/latest/USD");
            if (!fallbackResponse.ok) {
                throw new Error(`ExchangeRate-API respondió con estado ${fallbackResponse.status}`);
            }

            const fallbackData = (await fallbackResponse.json()) as ExchangeApiResponse;
            // Ambos proveedores exponen una propiedad 'rates' con formato similar
            return procesarYGuardarCache(fallbackData.rates);

        } catch (fallbackError: unknown) {
            console.error(`[Exchange Service] Fallo Crítico: Ambos proveedores cayeron. (${(fallbackError as Error).message})`);

            // 4. Último Recurso: Devolver caché obsoleta si existe (Alta Disponibilidad)
            if (ratesCache) {
                console.warn("[Exchange Service] Devolviendo caché en memoria obsoleta para evitar fallo del sistema.");
                return ratesCache.rates;
            }

            throw new Error("No se pudieron obtener las tasas de cambio y no hay historial en caché disponible.");
        }
    }
}

/**
 * Filtra solo las monedas que soporta el sistema (USD, EUR, ARS).
 * Si falta alguna de las monedas requeridas, lanza un error para obligar 
 * al sistema a usar el fallback o fallar ruidosamente.
 */
function procesarYGuardarCache(rawRates: Record<string, number>): Record<string, number> {
    const nextRates: Record<string, number> = { USD: 1 };

    if (typeof rawRates.EUR === "number" && Number.isFinite(rawRates.EUR)) {
        nextRates.EUR = rawRates.EUR;
    } else {
        throw new Error("La API no devolvió la cotización de EUR");
    }

    if (typeof rawRates.ARS === "number" && Number.isFinite(rawRates.ARS)) {
        nextRates.ARS = rawRates.ARS;
    } else {
        throw new Error("La API no devolvió la cotización de ARS");
    }

    ratesCache = {
        rates: nextRates,
        fetchedAt: Date.now(),
    };

    return ratesCache.rates;
}