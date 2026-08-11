export interface ExchangeRatePair {
    value: number;
}

export interface ExchangeRates {
    // 1. Tasas base estrictas (relativas a USD)
    USD: number;
    EUR: number;
    ARS: number;

    // 2. Solo los 6 pares cruzados válidos. Cero self-pairs.
    // Al no haber [key: string], TypeScript bloqueará cualquier moneda inválida.
    USD_EUR: ExchangeRatePair;
    USD_ARS: ExchangeRatePair;
    EUR_USD: ExchangeRatePair;
    EUR_ARS: ExchangeRatePair;
    ARS_USD: ExchangeRatePair;
    ARS_EUR: ExchangeRatePair;
}

interface ExchangeRateCacheState {
    rates: ExchangeRates;
    fetchedAt: number;
}

let ratesCache: ExchangeRateCacheState | null = null;
let activeRefreshPromise: Promise<ExchangeRates> | null = null;
let consecutiveFailures = 0;
let nextRetryAt = 0;

const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Validador helper (DRY) para garantizar que una tasa de cambio sea finita y mayor a cero.
 */
function isValidRate(rate: any): rate is number {
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

export async function getExchangeRates(): Promise<ExchangeRates> {
    if (ratesCache) {
        const cacheAge = Date.now() - ratesCache.fetchedAt;
        if (cacheAge > CACHE_TTL && !activeRefreshPromise) {
            console.log("[Exchange Service] Caché obsoleta detectada. Iniciando refresco asíncrono en segundo plano...");
            updateExchangeRatesCache().catch((err) => {
                console.error("[Exchange Service] Falló la actualización asíncrona de cotizaciones en segundo plano:", err);
            });
        }
        return ratesCache.rates;
    }

    if (Date.now() < nextRetryAt) {
        throw Object.assign(
            new Error("Imposible realizar cotización porque las cotizaciones se cayeron o no hay forma de cotizar (cooldown activo)"),
            { status: 503, code: "SERVICE_UNAVAILABLE" }
        );
    }

    if (activeRefreshPromise) {
        console.log("[Exchange Service] Carga inicial ya en progreso, esperando promesa activa...");
        return await activeRefreshPromise;
    }

    console.warn("[Exchange Service] Caché vacía. Iniciando carga forzada inicial...");
    return await updateExchangeRatesCache();
}

export async function updateExchangeRatesCache(): Promise<ExchangeRates> {
    if (activeRefreshPromise) {
        return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
        try {
            // 1. Proveedor Principal: Frankfurter v2 con timeout
            const response = await fetch("https://api.frankfurter.dev/v2/rates", {
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) {
                throw new Error(`Frankfurter v2 respondió con estado ${response.status}`);
            }

            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error("La respuesta de Frankfurter v2 no es un array válido");
            }

            let eurToUsd: number | undefined;
            let eurToArs: number | undefined;

            for (const entry of data) {
                if (entry && typeof entry === "object" && entry.base === "EUR") {
                    if (entry.quote === "USD" && entry.rate !== undefined) {
                        eurToUsd = Number(entry.rate);
                    } else if (entry.quote === "ARS" && entry.rate !== undefined) {
                        eurToArs = Number(entry.rate);
                    }
                }
            }

            if (!isValidRate(eurToUsd)) throw new Error("La API no devolvió la cotización válida de USD");
            if (!isValidRate(eurToArs)) throw new Error("La API no devolvió la cotización válida de ARS");

            const rawRates = {
                USD: 1.0,
                EUR: 1.0 / eurToUsd,
                ARS: eurToArs / eurToUsd
            };

            return procesarYGuardarCache(rawRates);

        } catch (primaryError: any) {
            console.warn(`[Exchange Service] Proveedor principal falló. Iniciando Fallback... (${primaryError.message})`);

            try {
                // 2. Proveedor de Respaldo: ExchangeRate-API con timeout
                const fallbackResponse = await fetch("https://open.er-api.com/v6/latest/USD", {
                    signal: AbortSignal.timeout(5000)
                });
                if (!fallbackResponse.ok) {
                    throw new Error(`ExchangeRate-API respondió con estado ${fallbackResponse.status}`);
                }

                const fallbackData = await fallbackResponse.json() as unknown;
                
                if (typeof fallbackData !== "object" || fallbackData === null || !("rates" in fallbackData)) {
                    throw new Error("Respuesta inválida o estructura mutada de ExchangeRate-API");
                }

                const ratesObj = (fallbackData as { rates: Record<string, any> }).rates;
                const eurRate = Number(ratesObj.EUR);
                const arsRate = Number(ratesObj.ARS);

                if (!isValidRate(eurRate)) throw new Error("La API de respaldo no devolvió la cotización válida de EUR");
                if (!isValidRate(arsRate)) throw new Error("La API de respaldo no devolvió la cotización válida de ARS");

                const rawRates = {
                    USD: 1.0,
                    EUR: eurRate,
                    ARS: arsRate
                };

                return procesarYGuardarCache(rawRates);

            } catch (fallbackError: any) {
                console.error(`[Exchange Service] Fallo Crítico: Ambos proveedores cayeron. (${fallbackError.message})`);

                consecutiveFailures++;
                const retryDelay = Math.min(5 * 60 * 1000 * Math.pow(2, consecutiveFailures - 1), 60 * 60 * 1000);
                nextRetryAt = Date.now() + retryDelay;

                if (ratesCache) {
                    console.warn("[Exchange Service] Devolviendo caché en memoria existente debido a fallas de red.");
                    ratesCache.fetchedAt = Date.now() - (CACHE_TTL - retryDelay);
                    return ratesCache.rates;
                }

                throw Object.assign(
                    new Error("Imposible realizar cotización porque las cotizaciones se cayeron o no hay forma de cotizar"),
                    { status: 503, code: "SERVICE_UNAVAILABLE" }
                );
            }
        }
    })();

    try {
        return await activeRefreshPromise;
    } finally {
        activeRefreshPromise = null;
    }
}

/**
 * Construye de forma explícita y estricta el objeto de tasas, omitiendo self-pairs
 * y cumpliendo con el contrato estricto de ExchangeRates.
 */
function procesarYGuardarCache(rawRates: { USD: number; EUR: number; ARS: number }): ExchangeRates {
    const { EUR: eurRate, ARS: arsRate } = rawRates;

    ratesCache = {
        rates: {
            USD: 1.0,
            EUR: eurRate,
            ARS: arsRate,

            USD_EUR: { value: eurRate },
            USD_ARS: { value: arsRate },

            EUR_USD: { value: 1.0 / eurRate },
            EUR_ARS: { value: arsRate / eurRate },

            ARS_USD: { value: 1.0 / arsRate },
            ARS_EUR: { value: eurRate / arsRate }
        },
        fetchedAt: Date.now()
    };

    consecutiveFailures = 0;
    nextRetryAt = 0;

    return ratesCache.rates;
}

export function clearCacheForTesting(): void {
    ratesCache = null;
    activeRefreshPromise = null;
    consecutiveFailures = 0;
    nextRetryAt = 0;
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    updateExchangeRatesCache().catch((err) => {
        console.error("[Exchange Service] Error al realizar la carga inicial de cotizaciones:", err);
    });

    const refreshInterval = setInterval(() => {
        console.log("[Exchange Service] Actualizando caché de cotizaciones en segundo plano...");
        updateExchangeRatesCache().catch((err) => {
            console.error("[Exchange Service] Falló la actualización de cotizaciones en segundo plano:", err);
        });
    }, 2 * 60 * 60 * 1000);
    refreshInterval.unref?.();
}