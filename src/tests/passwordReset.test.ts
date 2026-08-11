import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { query } from "../database/db";

const { enviarEmailConfirmacionMock } = vi.hoisted(() => ({
  enviarEmailConfirmacionMock: vi.fn(),
}));

vi.mock("../services/sesService.js", () => ({
  enviarEmailConfirmacion: enviarEmailConfirmacionMock,
}));

const GENERIC_MESSAGE =
  "Si el correo está registrado, vas a recibir instrucciones para restablecer tu contraseña.";

describe("Pruebas de integración de recuperación de contraseña", () => {
  const testUser = {
    email: "password_reset_test@valora.com",
    password: "PasswordOriginal123!",
    firstName: "Reset",
    lastName: "Test",
    dateOfBirth: "15/05/1995",
    phone: "+54 9 11 2345-6789",
    country: "AR",
    du: "44444444",
  };

  async function requestResetTokenLink(): Promise<string> {
    enviarEmailConfirmacionMock.mockResolvedValueOnce("mock-message-id");
    await request(app).post("/auth/forgot-password").send({ email: testUser.email });
    const lastCall = enviarEmailConfirmacionMock.mock.calls.at(-1)!;
    const cuerpoHtml = lastCall[0].cuerpoHtml as string;
    const match = cuerpoHtml.match(/token=([a-f0-9]+)/);
    if (!match) throw new Error("No se pudo extraer el token del email mockeado");
    return match[1];
  }

  beforeAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
    await request(app).post("/auth/register").send(testUser);
  });

  afterAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testUser.email]);
  });

  afterEach(() => {
    enviarEmailConfirmacionMock.mockClear();
  });

  describe("POST /auth/forgot-password", () => {
    it("responde con el mensaje genérico y envía el email de recuperación si el correo existe", async () => {
      enviarEmailConfirmacionMock.mockResolvedValueOnce("mock-message-id");

      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: testUser.email });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: GENERIC_MESSAGE });
      expect(enviarEmailConfirmacionMock).toHaveBeenCalledTimes(1);

      const callArgs = enviarEmailConfirmacionMock.mock.calls[0][0];
      expect(callArgs.destinatario).toBe(testUser.email);
      expect(callArgs.cuerpoHtml).toContain("/reset-password?token=");
    });

    it("responde con el mismo mensaje genérico si el correo no existe, sin enviar ningún email", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "no-existe-nadie-con-este-mail@valora.com" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: GENERIC_MESSAGE });
      expect(enviarEmailConfirmacionMock).not.toHaveBeenCalled();
    });

    it("rechaza un email con formato inválido", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "no-es-un-email" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /auth/reset-password", () => {
    it("cambia la contraseña con un token válido y permite loguearse con la nueva", async () => {
      const token = await requestResetTokenLink();

      const resetResponse = await request(app)
        .post("/auth/reset-password")
        .send({ token, password: "PasswordNueva456!" });

      expect(resetResponse.status).toBe(200);
      expect(resetResponse.body).toEqual({ message: "Tu contraseña fue actualizada correctamente." });

      const loginResponse = await request(app)
        .post("/auth/login")
        .send({ email: testUser.email, password: "PasswordNueva456!" });
      expect(loginResponse.status).toBe(200);

      testUser.password = "PasswordNueva456!";
    });

    it("invalida el token después de usarlo una vez (no se puede reusar)", async () => {
      const token = await requestResetTokenLink();

      const first = await request(app)
        .post("/auth/reset-password")
        .send({ token, password: "OtraPassword789!" });
      expect(first.status).toBe(200);
      testUser.password = "OtraPassword789!";

      const second = await request(app)
        .post("/auth/reset-password")
        .send({ token, password: "TerceraPassword000!" });
      expect(second.status).toBe(400);
      expect(second.body.error).toBe("InvalidTokenError");
    });

    it("rechaza un token inexistente", async () => {
      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token: "token-que-nunca-existio", password: "PasswordValida123!" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "InvalidTokenError",
        message: "El link de recuperación no es válido o expiró.",
      });
    });

    it("rechaza un token expirado", async () => {
      const token = await requestResetTokenLink();
      const crypto = await import("crypto");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      await query(
        "UPDATE users SET password_reset_expires_at = NOW() - INTERVAL '1 minute' WHERE password_reset_token_hash = $1",
        [tokenHash]
      );

      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token, password: "PasswordValida123!" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("InvalidTokenError");
    });

    it("rechaza una contraseña nueva demasiado corta", async () => {
      const token = await requestResetTokenLink();

      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token, password: "123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("VALIDATION_ERROR");
    });
  });
});
