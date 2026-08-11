import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../app.js";
import { query } from "../database/db.js";

describe("Pruebas de integración para compra y venta (BUY/SELL)", () => {
  const testUser = {
    email: "buysell_test_santiago@valora.com",
    password: "PasswordSegura123!",
    firstName: "Santiago",
    lastName: "Chavez",
    dateOfBirth: "15/05/1995",
    phone: "+5491123456789",
    country: "AR",
    du: "22222222",
  };

  const originalFetch = global.fetch;
  let authToken: string;
  let walletId: string;

  beforeAll(async () => {
    // 1. Limpieza quirúrgica de la DB
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);

    // 2. Mockear global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        amount: 1,
        base: "USD",
        date: "2026-01-01",
        rates: { EUR: 0.9, ARS: 1000 },
      }),
    }) as typeof fetch;

    // 3. Registrar usuario
    const registerResponse = await request(app)
      .post("/auth/register")
      .send(testUser);

    authToken = registerResponse.body.data.token;
    walletId = registerResponse.body.data.wallet.id;

    // 4. Depositar 200 USD para fondear la cuenta
    await request(app)
      .post("/transactions/deposit")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ currency: "USD", amount: 200 });
  });

  afterAll(async () => {
    // Restaurar mock
    global.fetch = originalFetch;
    // Limpieza quirúrgica final
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
  });

  it("debería realizar una compra exitosa (BUY) y retornar DTO camelCase", async () => {
    const response = await request(app)
      .post("/transactions/buy")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ fromCurrency: "USD", toCurrency: "EUR", amount: 100 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      transactionType: "BUY",
      walletId,
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      sourceAmount: 100,
    });
    expect(response.body.data).toHaveProperty("targetAmount");
    expect(response.body.data).toHaveProperty("exchangeRate");
    expect(response.body.data).toHaveProperty("resultingBalance");
    expect(response.body.data).toHaveProperty("createdAt");
  });

  it("debería realizar una venta exitosa (SELL) y retornar DTO camelCase", async () => {
    const response = await request(app)
      .post("/transactions/sell")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ fromCurrency: "USD", toCurrency: "ARS", amount: 50 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      transactionType: "SELL",
      walletId,
      sourceCurrency: "USD",
      targetCurrency: "ARS",
      sourceAmount: 50,
    });
    expect(response.body.data).toHaveProperty("targetAmount");
    expect(response.body.data).toHaveProperty("exchangeRate");
    expect(response.body.data).toHaveProperty("resultingBalance");
    expect(response.body.data).toHaveProperty("createdAt");
  });
});
