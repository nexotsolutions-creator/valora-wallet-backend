import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app";
import { query } from "../database/db";

describe("Pruebas de Billetera (Wallets)", () => {
  let testToken: string;
  const testUser = {
    email: "alias_test@valora.com",
    password: "PasswordSegura123!",
    firstName: "Alias",
    lastName: "Tester",
    dateOfBirth: "15/05/1995",
    phone: "+54 9 11 2345-6789",
    country: "AR",
    du: "87654321"
  };

  beforeAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
    // Registrar usuario
    const res = await request(app)
      .post("/auth/register")
      .send(testUser);
    if (!res.body.data || !res.body.data.token) {
        console.error("REGISTRATION FAILED:", res.body);
    }
    testToken = res.body.data.token;
  });

  afterAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
  });

  it("Debería permitir actualizar el alias correctamente", async () => {
    const res = await request(app)
      .put("/wallet/alias")
      .set("Authorization", `Bearer ${testToken}`)
      .send({ alias: "mialiasgenial.123" });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.wallet.alias).toBe("mialiasgenial.123");
  });

  it("Debería retornar 409 si el alias ya existe", async () => {
    const anotherUser = { ...testUser, email: "stealer@valora.com", du: "87654322" };
    await query("DELETE FROM users WHERE email = $1", [anotherUser.email]);
    const res2 = await request(app).post("/auth/register").send(anotherUser);
    const token2 = res2.body.data.token;

    const resFail = await request(app)
      .put("/wallet/alias")
      .set("Authorization", `Bearer ${token2}`)
      .send({ alias: "mialiasgenial.123" });

    expect(resFail.status).toBe(409);
    expect(resFail.body.success).toBe(false);

    await query("DELETE FROM users WHERE email = $1", [anotherUser.email]);
  });
});
