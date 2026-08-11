import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { generateToken, verifyToken } from "../utils/jwt.js";

describe("Seguridad JWT", () => {
  let originalJwtSecret: string | undefined;

  beforeAll(() => {
    // Guardamos el secreto original y seteamos uno de prueba de forma segura
    originalJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "secreto-de-prueba-muy-seguro";
  });

  afterAll(() => {
    // Restauramos el entorno global para no contaminar otras suites
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it("debería generar un token con una expiración exacta de 15 minutos (900 segundos)", () => {
    const payload = { userId: "test-uuid", email: "seguridad@valora.com" };
    const token = generateToken(payload);
    
    // Decodificamos el token sin validarlo
    const decoded = jwt.decode(token);
    
    // Validación estricta de tipos (evita TypeError si decode falla y retorna null/string)
    expect(decoded).not.toBeNull();
    expect(typeof decoded).toBe("object");
    
    // Ahora es 100% seguro hacer el casteo
    const payloadObject = decoded as jwt.JwtPayload;
    
    expect(payloadObject.exp).toBeDefined();
    expect(payloadObject.iat).toBeDefined();
    
    // 15 minutos = 15 * 60 = 900 segundos
    const durationInSeconds = payloadObject.exp! - payloadObject.iat!;
    expect(durationInSeconds).toBe(900);
  });

  it("debería verificar y extraer correctamente el payload", () => {
    const payload = { userId: "test-uuid", email: "seguridad@valora.com" };
    const token = generateToken(payload);
    
    const verified = verifyToken(token);
    expect(verified.userId).toBe(payload.userId);
    expect(verified.email).toBe(payload.email);
  });
});
