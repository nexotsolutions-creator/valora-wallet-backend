import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../app";
import { query } from "../database/db";

describe("GET /catalogs/document-types", () => {
  it("devuelve el mapa completo de documentos por país", async () => {
    const response = await request(app).get("/catalogs/document-types");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Object.keys(response.body.data)).toHaveLength(19);
    expect(response.body.data.AR).toBe("DNI");
  });
});

describe("POST /auth/register con validación genérica de documento", () => {
  const email = `doc_test_br_${Date.now()}@valora.com`;

  afterAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [email]);
  });

  it("permite registrar con un país fuera del set original (Brasil), antes no soportado", async () => {
    const response = await request(app).post("/auth/register").send({
      email,
      password: "PasswordSegura123!",
      firstName: "Joao",
      lastName: "Silva",
      dateOfBirth: "15/05/1995",
      phone: "+54 9 11 2345-6789",
      country: "BR",
      du: "A1B2C3D4E5",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.country).toBe("BR");
    expect(response.body.data.user.du).toBe("A1B2C3D4E5");
  });
});
