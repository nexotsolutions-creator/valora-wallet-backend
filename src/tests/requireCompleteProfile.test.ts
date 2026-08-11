import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { query } from "../database/db";

vi.mock("google-auth-library", () => {
  return {
    OAuth2Client: class {
      verifyIdToken = vi.fn().mockResolvedValue({
        getPayload: () => ({
          email: "perfil_incompleto_test@valora.com",
          email_verified: true,
          given_name: "Incompleto",
          family_name: "Test",
        }),
      });
    },
  };
});

describe("requireCompleteProfile (bloqueo de operaciones con perfil incompleto)", () => {
  const email = "perfil_incompleto_test@valora.com";
  const originalFetch = global.fetch;
  let token: string;

  beforeAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [email]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        amount: 1,
        base: "USD",
        date: "2024-01-01",
        rates: { ARS: 1000 },
      }),
    }) as typeof fetch;

    // Login con Google: crea la cuenta sin celular ni DU (ver googleLoginController).
    const loginResponse = await request(app)
      .post("/auth/google")
      .send({ idToken: "valid-token" });
    token = loginResponse.body.data.token;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await query("DELETE FROM users WHERE email = $1", [email]);
  });

  it("bloquea un depósito si la cuenta no tiene celular ni DU cargados", async () => {
    const response = await request(app)
      .post("/transactions/deposit")
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "USD", amount: 10 });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe("IncompleteProfileError");
  });

  it("no bloquea /transactions/quote, que es de solo lectura", async () => {
    const response = await request(app)
      .post("/transactions/quote")
      .set("Authorization", `Bearer ${token}`)
      .send({ fromCurrency: "USD", toCurrency: "ARS", amount: 10 });

    expect(response.status).not.toBe(403);
  });

  it("permite depositar una vez que se completa celular y DU vía PATCH /auth/me", async () => {
    const patchResponse = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "+54 9 11 5678-1234", country: "AR", du: "50501010" });

    expect(patchResponse.status).toBe(200);

    const depositResponse = await request(app)
      .post("/transactions/deposit")
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "USD", amount: 10 });

    expect(depositResponse.status).toBe(200);
  });
});
