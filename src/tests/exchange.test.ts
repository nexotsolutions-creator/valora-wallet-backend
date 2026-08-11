import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getExchangeRates, clearCacheForTesting } from "../services/exchangeRateService.js";

describe("Exchange Rate Service Integration Tests", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        // Restaurar todos los mocks y limpiar la caché en memoria para garantizar aislamiento
        vi.restoreAllMocks();
        clearCacheForTesting();
    });

    afterEach(() => {
        // Restaurar la implementación original de fetch
        global.fetch = originalFetch;
    });

    it("should throw an error when the external API fails and cache is empty (Unhappy Path)", async () => {
        // Simulamos un error 500 de Frankfurter API
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
        }) as typeof fetch;

        // Esperamos que falle con el error personalizado en español
        await expect(getExchangeRates()).rejects.toThrow(
            "Imposible realizar cotización porque las cotizaciones se cayeron o no hay forma de cotizar"
        );
    });

    it("should fetch and parse rates successfully from Frankfurter v2 (Happy Path)", async () => {
        // Estructura de array que retorna Frankfurter v2
        const mockFrankfurterResponse = [
            { base: "EUR", quote: "USD", rate: 1.08 },
            { base: "EUR", quote: "ARS", rate: 1080 }
        ];

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockFrankfurterResponse
        }) as typeof fetch;

        const rates = await getExchangeRates();

        // USD base es siempre 1.0
        expect(rates.USD).toBe(1.0);
        
        // EUR es 1.0 / eurToUsd
        expect(rates.EUR).toBeCloseTo(1.0 / 1.08, 5);
        
        // ARS es eurToArs / eurToUsd
        expect(rates.ARS).toBeCloseTo(1080 / 1.08, 5);

        // Validamos el formato de pares cruzados P2P
        expect(rates.USD_ARS).toBeDefined();
        expect(rates.USD_ARS!.value).toBeCloseTo(1080 / 1.08, 5);
        
        expect(rates.EUR_USD).toBeDefined();
        expect(rates.EUR_USD!.value).toBeCloseTo(1.08, 5);
    });

    it("should fallback to ExchangeRate-API when Frankfurter v2 fails (Fallback Happy Path)", async () => {
        // Estructura de objeto de ExchangeRate-API
        const mockFallbackResponse = {
            rates: {
                EUR: 0.925,
                ARS: 1000
            }
        };

        // Primera petición (Frankfurter) falla, segunda petición (ExchangeRate-API) tiene éxito
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 500
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockFallbackResponse
            }) as typeof fetch;

        const rates = await getExchangeRates();

        expect(rates.USD).toBe(1.0);
        expect(rates.EUR).toBe(0.925);
        expect(rates.ARS).toBe(1000);

        // Validamos el formato de pares cruzados P2P desde el fallback
        expect(rates.USD_EUR).toBeDefined();
        expect(rates.USD_EUR!.value).toBe(0.925);
        
        expect(rates.EUR_ARS).toBeDefined();
        expect(rates.EUR_ARS!.value).toBeCloseTo(1000 / 0.925, 5);
    });

    it("should prevent aggressive retries and throw cooldown error on consecutive failures", async () => {
        // Simulamos un error 500 de ambas APIs (falla total)
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
        }) as typeof fetch;

        // Primera petición: falla y establece el cooldown
        await expect(getExchangeRates()).rejects.toThrow(
            "Imposible realizar cotización porque las cotizaciones se cayeron o no hay forma de cotizar"
        );

        // Verificamos que fetch se llamó 2 veces (Frankfurter + Fallback)
        expect(global.fetch).toHaveBeenCalledTimes(2);

        // Segunda petición INMEDIATA (dentro del cooldown): debe bloquearse SIN llamar a fetch
        await expect(getExchangeRates()).rejects.toThrow(
            "Imposible realizar cotización porque las cotizaciones se cayeron o no hay forma de cotizar (cooldown activo)"
        );

        // Verificamos que fetch SIGUE habiendo sido llamado 2 veces (no aumentó, el short-circuit funcionó)
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});