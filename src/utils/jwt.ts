import jwt from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
  email: string;
}

/**
 * Obtiene y valida la clave secreta para firmar y verificar tokens JWT.
 * @returns La clave secreta de JWT como un string garantizado.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("La variable de entorno JWT_SECRET no está configurada.");
  }
  return secret;
}

/**
 * Genera un token JWT firmado con validez de 15 minutos.
 * @param payload - Datos del usuario a incluir en el token.
 * @returns El token JWT firmado.
 */
export function generateToken(payload: JwtPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "15m" });
}

/**
 * Verifica y decodifica un token JWT.
 * @param token - Token JWT a verificar.
 * @returns El payload decodificado si el token es válido.
 */
export function verifyToken(token: string): JwtPayload {
  const secret = getJwtSecret();
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });

  if (!decoded || typeof decoded !== "object" || !("userId" in decoded) || !("email" in decoded)) {
    throw new Error("El token decodificado no contiene una estructura JwtPayload válida.");
  }

  const payload = decoded as Record<string, unknown>;
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    throw new Error("El token decodificado no contiene una estructura JwtPayload válida.");
  }

  return {
    userId: payload.userId,
    email: payload.email,
  };
}