import request from "supertest";
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { app } from "../app.js";
import { pool } from "../database/db.js";

describe("Pruebas de CORS, JSON malformado y stack traces", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.restoreAllMocks();
    // Restaurar entorno original
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restaurar entorno al finalizar la suite
    process.env = { ...originalEnv };
  });

  describe("CORS Whitelist", () => {
    it("debería permitir orígenes en la lista blanca de CORS", async () => {
      const response = await request(app)
        .get("/health")
        .set("Origin", "http://localhost:5173");

      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("debería rechazar orígenes no permitidos por CORS", async () => {
      const response = await request(app)
        .get("/health")
        .set("Origin", "http://sitio-malicioso.com");

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("CORS_ERROR");
      expect(response.body.message).toBe("No permitido por CORS");
    });

    it("debería permitir previews de Vercel de este proyecto (ramas/PRs)", async () => {
      const previewOrigin = "https://valora-wallet-frontend-git-analia-nexo-tech-solutions.vercel.app";
      const response = await request(app)
        .get("/health")
        .set("Origin", previewOrigin);

      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(previewOrigin);
    });

    it("no debería permitir un dominio de Vercel de otro proyecto", async () => {
      const response = await request(app)
        .get("/health")
        .set("Origin", "https://otro-proyecto.vercel.app");

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("CORS_ERROR");
    });

    it("no debería permitir un dominio de terceros que empiece igual pero con otro team slug", async () => {
      // Caso puntual detectado en review: los nombres de proyecto en Vercel no
      // están reservados globalmente, así que cualquiera podría registrar un
      // proyecto propio con el prefijo "valora-wallet-frontend". Sin exigir
      // el team slug real, ese dominio pasaría el whitelist igual.
      const response = await request(app)
        .get("/health")
        .set("Origin", "https://valora-wallet-frontend-atacante-otro-team.vercel.app");

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("CORS_ERROR");
    });
  });

  describe("Manejo de JSON Malformado", () => {
    it("debería capturar JSON malformado en el body y retornar 400", async () => {
      const response = await request(app)
        .post("/auth/login")
        .set("Content-Type", "application/json")
        .send("{ email: bad-json");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "INVALID_JSON",
        message: "El cuerpo de la solicitud contiene un JSON con formato inválido."
      });
    });
  });

  describe("Stack Trace en Producción", () => {
    it("no debería incluir la propiedad stack en las respuestas de error en producción", async () => {
      // Forzar entorno de producción
      process.env.NODE_ENV = "production";

      // Simular un fallo de base de datos para forzar un error 500 no controlado
      vi.spyOn(pool, "query").mockRejectedValue(new Error("Database query error"));

      const response = await request(app)
        .post("/auth/login")
        .send({ email: "test@valora.com", password: "pwd" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body).not.toHaveProperty("stack");
    });
  });
});
