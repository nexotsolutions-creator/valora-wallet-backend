export interface RateData {
    value: number;
    source: string;
    updatedAt: string;
}

interface ExchangeRateCacheState {
    rates: Record<string, RateData>;
    fetchedAt: number;
    lastDolarApiUpdate: string | null;
}

let ratesCache: ExchangeRateCacheState | null = null;

// Constante de tiempo: 24 horas (para Frankfurter y fallbacks generales)
const CACHE_TTL = 24 * 60 * 60 * 1000;
// Polling de 5 minutos para revisar si DolarApi actualizó su fecha
const DOLARAPI_POLL_INTERVAL = 5 * 60 * 1000;

export async function getExchangeRates(forceFresh: boolean = false): Promise<Record<string, RateData>> {
    const now = Date.now();

    // 1. Manejo inteligente de caché (Ruta Feliz de reuso rápido)
    if (ratesCache && !forceFresh) {
        const timeSinceLastFetch = now - ratesCache.fetchedAt;
        if (timeSinceLastFetch < DOLARAPI_POLL_INTERVAL) {
            return ratesCache.rates;
        }
    }

    try {
        // 🟢 TRY: INTENTO PRINCIPAL
        let arsRateValue: number | null = null;
        let eurRateValue: number | null = null;
        let dolarApiUpdatedStr: string | null = null;
        let frankfurterUpdatedStr: string | null = null;

        // -> Ejecución 1: DolarApi (USD ↔ ARS)
        const responseD = await fetch("https://dolarapi.com/v1/dolares/oficial");
        if (responseD.ok) {
            const dataD = (await responseD.json()) as any;
            if (typeof dataD.compra === "number" && dataD.fechaActualizacion) {
                // Verificamos si realmente hay un dato nuevo
                if (!forceFresh && ratesCache?.lastDolarApiUpdate === dataD.fechaActualizacion) {
                    if (now - ratesCache!.fetchedAt < CACHE_TTL) {
                        return ratesCache!.rates; // Caché vigente
                    }
                }
                arsRateValue = dataD.compra;
                dolarApiUpdatedStr = dataD.fechaActualizacion;
            }
        }

        if (arsRateValue === null) throw new Error("Fallo en la extracción de datos de DolarApi");

        // -> Ejecución 2: Frankfurter (USD ↔ EUR)
        // Solo lo llamamos si forzamos, si la caché caducó, o si no tenemos caché
        if (forceFresh || !ratesCache || (now - ratesCache.fetchedAt) >= CACHE_TTL) {
            const responseF = await fetch("https://api.frankfurter.app/latest?from=USD");
            if (responseF.ok) {
                const dataF = (await responseF.json()) as any;
                if (typeof dataF.rates.EUR === "number") {
                    eurRateValue = dataF.rates.EUR;
                    frankfurterUpdatedStr = dataF.date ? new Date(dataF.date).toISOString() : new Date().toISOString();
                }
            }
        } else {
            // Reusamos el EUR de la caché (Ruta feliz de ahorro de tokens)
            eurRateValue = ratesCache!.rates["USD_EUR"].value;
            frankfurterUpdatedStr = ratesCache!.rates["USD_EUR"].updatedAt;
        }

        if (eurRateValue === null) throw new Error("Fallo en la extracción de datos de Frankfurter");

        // Si todo sale bien, procesamos y guardamos (sin entrar jamás al catch)
        return procesarYGuardarFusion(arsRateValue, dolarApiUpdatedStr!, eurRateValue, frankfurterUpdatedStr!);

    } catch (error) {
        // 🔴 CATCH: SISTEMA DE FALLBACKS
        console.warn("[Exchange Service] Fallo en el flujo principal (Try). Iniciando Fallbacks en el Catch...", error);

        try {
            // Fallback 1: ExchangeRate-API (Intenta rescatar EUR y ARS juntos)
            console.log("[Exchange Service] Ejecutando Fallback: ExchangeRate-API");
            const responseE = await fetch("https://open.er-api.com/v6/latest/USD");
            if (responseE.ok) {
                const dataE = (await responseE.json()) as any;
                if (typeof dataE.rates.ARS === "number" && typeof dataE.rates.EUR === "number") {
                    const arsRate = dataE.rates.ARS;
                    const eurRate = dataE.rates.EUR;
                    const dateStr = dataE.time_last_update_utc ? new Date(dataE.time_last_update_utc).toISOString() : new Date().toISOString();
                    
                    return procesarYGuardarFusion(arsRate, dateStr, eurRate, dateStr);
                }
            }
            throw new Error("ExchangeRate-API devolvió un payload inválido");

        } catch (errorFallback) {
            console.error("[Exchange Service] Fallback 1 (ExchangeRate-API) también falló.");

            // Fallback 2: Caché de Emergencia
            if (ratesCache) {
                console.warn("[Exchange Service] Fallback 2: Devolviendo memoria caché de emergencia.");
                return ratesCache.rates;
            }

            // Muerte del sistema
            throw new Error("Sistema caído: No hay conexión a APIs ni memoria caché disponible.");
        }
    }
}

function procesarYGuardarFusion(
    arsRate: number, dolarApiDate: string, 
    eurRate: number, eurDate: string
): Record<string, RateData> {
    
    const timestampCalc = new Date().toISOString();
    
    // Cálculo cruzado
    const arsEur = eurRate / arsRate;
    const eurArs = arsRate / eurRate;

    ratesCache = {
        rates: {
            "USD_ARS": { value: arsRate, source: "DolarApi", updatedAt: dolarApiDate },
            "ARS_USD": { value: 1 / arsRate, source: "DolarApi (Invertido)", updatedAt: dolarApiDate },
            
            "USD_EUR": { value: eurRate, source: "Frankfurter", updatedAt: eurDate },
            "EUR_USD": { value: 1 / eurRate, source: "Frankfurter (Invertido)", updatedAt: eurDate },
            
            "ARS_EUR": { value: arsEur, source: "Calculado Cruzado", updatedAt: timestampCalc },
            "EUR_ARS": { value: eurArs, source: "Calculado Cruzado", updatedAt: timestampCalc }
        },
        fetchedAt: Date.now(),
        lastDolarApiUpdate: dolarApiDate
    };

    return ratesCache.rates;
}