import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { query } from "../database/db.js";
import { findBalanceByWalletAndCurrency } from "../models/balanceModel.js";

describe("Pruebas de integración de transacciones", () => {
  const testUser = {
    email: "transaction_test_santiago@valora.com",
    password: "PasswordSegura123!",
    firstName: "Santiago",
    lastName: "Chavez",
    dateOfBirth: "15/05/1995",
    phone: "+5491123456789",
    country: "AR",
    du: "33333333",
  };

  const originalFetch = global.fetch;
  let authToken: string;
  let walletId: string;

  beforeAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        amount: 1,
        base: "USD",
        date: "2024-01-01",
        rates: { EUR: 1.1, ARS: 1000 },
      }),
    }) as typeof fetch;

    const registerResponse = await request(app)
      .post("/auth/register")
      .send(testUser);

    authToken = registerResponse.body.data.token;
    walletId = registerResponse.body.data.wallet.id;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
  });

  it("debería registrar un depósito exitoso y actualizar el saldo del usuario", async () => {
    const response = await request(app)
      .post("/transactions/deposit")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ currency: "USD", amount: 100 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      transactionType: "DEPOSIT",
      walletId,
      resultingBalance: 100,
    });

    const balance = await findBalanceByWalletAndCurrency(walletId, "USD");
    expect(balance).not.toBeNull();
    expect(parseFloat(balance!.amount)).toBe(100);
  });

  it("debería rechazar un depósito con un monto inválido", async () => {
    const response = await request(app)
      .post("/transactions/deposit")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ currency: "USD", amount: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "VALIDATION_ERROR",
      message: "El monto debe ser un número mayor a cero.",
    });
  });

  it("debería ejecutar un intercambio exitoso y actualizar ambos saldos", async () => {
    const response = await request(app)
      .post("/transactions/exchange")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ fromCurrency: "USD", toCurrency: "EUR", amount: 50 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      transactionType: "EXCHANGE",
      walletId,
      sourceCurrency: "USD",
      targetCurrency: "EUR",
    });

    const usdBalance = await findBalanceByWalletAndCurrency(walletId, "USD");
    const eurBalance = await findBalanceByWalletAndCurrency(walletId, "EUR");

    expect(usdBalance).not.toBeNull();
    expect(eurBalance).not.toBeNull();
    expect(parseFloat(usdBalance!.amount)).toBe(50);
    expect(parseFloat(eurBalance!.amount)).toBe(55);
  });

  it("debería rechazar un intercambio si el usuario no tiene fondos suficientes (Camino Infeliz)", async () => {
    // El usuario intenta intercambiar 100 USD, pero solo le quedan 50 USD de las pruebas anteriores
    const response = await request(app)
      .post("/transactions/exchange")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ fromCurrency: "USD", toCurrency: "ARS", amount: 100 });

    // Esperamos un error HTTP 400 manejado por el errorHandler centralizado
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "INSUFFICIENT_FUNDS",
      message: "Saldo insuficiente para realizar la operación."
    });
  });

  describe("POST /transactions/quote", () => {
    it("debería retornar una cotización válida (Caso Feliz)", async () => {
      const response = await request(app)
        .post("/transactions/quote")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ fromCurrency: "USD", toCurrency: "ARS", amount: 100 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("exchangeRate");
      expect(response.body.data).toHaveProperty("targetAmount");
      // Según el mock definido en el beforeAll: ARS = 1000, USD = base (1)
      expect(response.body.data.exchangeRate).toBe(1000);
      expect(response.body.data.targetAmount).toBe(100000);
    });

    it("debería rechazar una cotización con una moneda no soportada (Caso Inválido)", async () => {
      const response = await request(app)
        .post("/transactions/quote")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ fromCurrency: "USD", toCurrency: "BRL", amount: 100 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "UNSUPPORTED_CURRENCY",
        message: "Moneda no soportada para cotización."
      });
    });
  });

  describe("GET /transactions", () => {
    it("debería retornar la lista de transacciones del usuario autenticado", async () => {
      const response = await request(app)
        .get("/transactions")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data[0]).toHaveProperty("transactionType");
      expect(response.body.data[0]).toHaveProperty("walletId", walletId);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        totalCount: expect.any(Number),
        totalPages: expect.any(Number)
      });
    });

    it("debería aplicar paginación correctamente mediante query params", async () => {
      const response = await request(app)
        .get("/transactions?limit=1&page=1")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 1,
        totalCount: 2,
        totalPages: 2
      });
    });

    it("debería rechazar la consulta si no se proporciona el token de autenticación", async () => {
      const response = await request(app)
        .get("/transactions");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: "UnauthorizedError",
        message: "Acceso no autorizado. Token no proporcionado."
      });
    });
  });
});