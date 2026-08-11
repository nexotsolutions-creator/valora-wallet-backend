import type { Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import { generateToken } from "../utils/jwt.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserProfile,
  setPasswordResetToken,
  resetPasswordWithValidToken,
  type User,
} from "../models/userModel.js";
import { createWallet, findWalletByUserId, type Wallet } from "../models/walletModel.js";
import { createOrUpdateBalance, findBalancesByWalletId } from "../models/balanceModel.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { pool } from "../database/db.js";
import { enviarEmailConfirmacion } from "../services/sesService.js";
import { validarCelular } from "../utils/phoneValidation.js";

const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos
const PASSWORD_RESET_GENERIC_MESSAGE =
  "Si el correo está registrado, vas a recibir instrucciones para restablecer tu contraseña.";
const SUPPORT_EMAIL = "nexot.solutions@gmail.com";
const DUPLICATE_FIELD_GENERIC_MESSAGE =
  `No pudimos guardar esos datos. Si creés que se trata de un error, escribinos a ${SUPPORT_EMAIL}.`;

export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  phone?: string | null;
  country?: string;
  du?: string | null;
  profileComplete?: boolean;
}

function formatDate(dateInput: Date | string | null | undefined): string | null {
  if (!dateInput) return null;
  if (typeof dateInput === "string") {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateInput)) return dateInput;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const parts = dateInput.split("-");
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const parsedDate = new Date(dateInput);
    if (isNaN(parsedDate.getTime())) return dateInput;
    
    const year = parsedDate.getUTCFullYear();
    const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getUTCDate()).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }

  const year = dateInput.getFullYear();
  const month = String(dateInput.getMonth() + 1).padStart(2, "0");
  const day = String(dateInput.getDate()).padStart(2, "0");
  return `${day}/${month}/${year}`;
}

export function toUserResponse(user: User, includePII = true): UserResponse {
  const response: UserResponse = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
  };

  if (includePII) {
    response.dateOfBirth = formatDate(user.date_of_birth);
    response.phone = user.phone || null;
    response.country = user.country;
    response.du = user.du || null;
    // Le indica al frontend cuándo mostrar el paso de "completar perfil" (ej. tras un
    // alta por Google, que arranca sin celular ni DU) — ver requireCompleteProfile.ts,
    // que es quien realmente bloquea las operaciones de billetera del lado del backend.
    response.profileComplete = Boolean(user.phone) && Boolean(user.du);
  }

  return response;
}

/**
 * HELPER DRY: Genera la respuesta estándar de sesión (Token + Perfil + Wallet)
 */
function sendAuthSuccess(res: Response, statusCode: number, user: User, wallet: Wallet) {
  const token = generateToken({ userId: user.id, email: user.email });
  res.status(statusCode).json({
    success: true,
    data: {
      token,
      user: toUserResponse(user),
      wallet: {
        id: wallet.id,
        cvu: wallet.cvu,
        alias: wallet.alias
      }
    }
  });
}

export async function registerController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password, firstName, lastName, dateOfBirth, phone, country, du } = req.body;

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: "DuplicateEmailError",
        message: "El correo electrónico ya se encuentra registrado"
      });
      return;
    }

    // El schema de Zod ya validó que sea un celular real vía validarCelular; acá lo volvemos
    // a llamar para obtener el valor normalizado en E.164 y nunca persistir el string crudo.
    const celular = validarCelular(phone, country);
    if (!celular.e164) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "El número de celular provisto no es válido."
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const user = await createUser(email, passwordHash, firstName, lastName, dateOfBirth, celular.e164, country, du, client);
      const wallet = await createWallet(user.id, firstName, client);
      await createOrUpdateBalance(wallet.id, "USD", "0.00000000", client);
      
      await client.query("COMMIT");
      
      sendAuthSuccess(res, 201, user, wallet);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (e) { /* Ignorar error de rollback */ }
      throw error;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const constraint = "constraint" in error ? String((error as { constraint?: unknown }).constraint) : "";
      if (constraint.includes("email")) {
        res.status(400).json({
          success: false,
          error: "DuplicateEmailError",
          message: "El correo electrónico ya se encuentra registrado"
        });
        return;
      }
      // Colisión en otra columna (ej. DU): mensaje genérico a propósito, no confirmar que
      // "ese DNI ya existe" evita que el registro sirva para probar si un DNI específico
      // ya está en el sistema.
      res.status(400).json({
        success: false,
        error: "DuplicateFieldError",
        message: DUPLICATE_FIELD_GENERIC_MESSAGE,
      });
      return;
    }
    next(error);
  }
}

export async function loginController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) {
      res.status(401).json({ success: false, error: "UnauthorizedError", message: "Credenciales incorrectas." });
      return;
    }

    if (!user.password_hash) {
      res.status(401).json({
        success: false,
        error: "UnauthorizedError",
        message: "Esta cuenta utiliza inicio de sesión con Google. Por favor, usa el botón de Google."
      });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({ success: false, error: "UnauthorizedError", message: "Credenciales incorrectas." });
      return;
    }

    const wallet = await findWalletByUserId(user.id);
    if (!wallet) {
      res.status(404).json({ success: false, error: "NotFoundError", message: "Billetera no encontrada." });
      return;
    }

    sendAuthSuccess(res, 200, user, wallet);
  } catch (error: unknown) {
    next(error);
  }
}

export async function meController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ success: false, error: "UnauthorizedError", message: "Token no proporcionado." });
      return;
    }

    const user = await findUserById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: "NotFoundError", message: "Usuario no encontrado." });
      return;
    }

    const wallet = await findWalletByUserId(user.id);
    if (!wallet) {
      res.status(404).json({ success: false, error: "NotFoundError", message: "Billetera no encontrada." });
      return;
    }

    const balances = await findBalancesByWalletId(wallet.id);

    res.status(200).json({
      success: true,
      data: {
        user: toUserResponse(user),
        wallet: {
          id: wallet.id,
          cvu: wallet.cvu,
          alias: wallet.alias
        },
        balances
      }
    });
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Completa (o edita) celular, país y DU de la cuenta autenticada. Pensado sobre todo
 * para las cuentas creadas vía Google, que no piden estos datos en el alta.
 */
export async function completeProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "UnauthorizedError", message: "Token no proporcionado." });
      return;
    }

    const { phone, country, du } = req.body;

    // El schema de Zod ya validó que sea un celular real vía validarCelular; acá lo volvemos
    // a llamar para obtener el valor normalizado en E.164 y nunca persistir el string crudo.
    const celular = validarCelular(phone, country);
    if (!celular.e164) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "El número de celular provisto no es válido."
      });
      return;
    }

    const user = await updateUserProfile(userId, celular.e164, country, du);
    if (!user) {
      res.status(404).json({ success: false, error: "NotFoundError", message: "Usuario no encontrado." });
      return;
    }
    res.status(200).json({ success: true, data: { user: toUserResponse(user) } });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      // Mensaje genérico a propósito para celular y DU por igual: no confirmar que "ese dato
      // ya existe" evita que este endpoint sirva para probar si un DNI o celular específico
      // ya está registrado en el sistema.
      res.status(400).json({
        success: false,
        error: "DuplicateFieldError",
        message: DUPLICATE_FIELD_GENERIC_MESSAGE,
      });
      return;
    }
    next(error);
  }
}

export function logoutController(_req: AuthenticatedRequest, res: Response): void {
  res.status(200).json({
    success: true,
    message: "Sesión cerrada correctamente. Por favor, descarta el token en el cliente."
  });
}

const googleClient = process.env.GOOGLE_CLIENT_ID 
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) 
  : null;

export async function googleLoginController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!googleClient) {
      res.status(500).json({
        success: false,
        error: "InternalServerError",
        message: "El inicio de sesión con Google no está configurado en este servidor."
      });
      return;
    }

    const { idToken } = req.body;

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      res.status(401).json({
        success: false,
        error: "UnauthorizedError",
        message: "Token de Google inválido o expirado."
      });
      return;
    }
    
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) {
      res.status(401).json({ 
        success: false, 
        error: "UnauthorizedError", 
        message: "Token inválido o email no verificado por Google." 
      });
      return;
    }

    const { email, given_name, family_name } = payload;
    let user = await findUserByEmail(email);
    let wallet: Wallet | undefined;

    if (user) {
      if (user.password_hash !== null) {
        res.status(400).json({
          success: false,
          error: "DuplicateEmailError",
          message: "El correo electrónico ya se encuentra registrado"
        });
        return;
      }
      const existingWallet = await findWalletByUserId(user.id);
      if (!existingWallet) throw new Error("El usuario de Google existe pero no tiene billetera.");
      wallet = existingWallet;
    } else {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Celular, país y DU no se piden en el alta con Google: quedan sin completar
        // (en vez de un placeholder inventado) hasta que el usuario los cargue desde
        // PATCH /auth/me.
        user = await createUser(email, null, given_name || "Usuario", family_name || "", "1990-01-01", null, "AR", null, client);
        const newWallet = await createWallet(user.id, given_name || "Usuario", client);
        await createOrUpdateBalance(newWallet.id, "USD", "0.00000000", client);
        await client.query("COMMIT");
        wallet = newWallet;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (e) { /* Ignorar */ }
        
        // Manejo de condición de carrera para Google Sign-in
        if (error && typeof error === "object" && "code" in error && error.code === "23505") {
          // El usuario fue creado concurrentemente. Lo recuperamos en lugar de fallar.
          user = await findUserByEmail(email);
          if (user) {
             const existingWallet = await findWalletByUserId(user.id);
             if (existingWallet) {
               wallet = existingWallet;
             } else {
               throw new Error("Error de consistencia en base de datos al buscar billetera existente.");
             }
          } else {
             throw error; 
          }
        } else {
          throw error;
        }
      } finally {
        client.release();
      }
    }

    sendAuthSuccess(res, 200, user, wallet!);
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Controlador para solicitar la recuperación de contraseña.
 * Siempre responde con el mismo mensaje genérico, exista o no el email, para no revelar
 * qué correos están registrados. Si el fallo es al enviar el email, tampoco se filtra al cliente.
 * El envío del email no se espera (fire-and-forget): es la parte más lenta del flujo (red hacia
 * SES) y esperarla permitiría distinguir por timing si el email existe o no, aunque la respuesta
 * sea idéntica en ambos casos.
 */
export async function forgotPasswordController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = req.body;

    const user = await findUserByEmail(email);
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

      await setPasswordResetToken(user.id, tokenHash, expiresAt);

      const frontendUrl = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
      if (!frontendUrl) {
        console.error("FRONTEND_URL no está configurada: el link de recuperación de contraseña quedará roto en el email.");
      }
      const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

      // No se loguea acá: sesService.ts ya loguea el error internamente antes de re-lanzarlo.
      // Este catch solo existe para evitar un unhandled rejection.
      enviarEmailConfirmacion({
        destinatario: user.email,
        asunto: "Recuperación de contraseña - Valora Wallet",
        cuerpoHtml: `<p>Recibimos una solicitud para restablecer tu contraseña en Valora Wallet.</p><p><a href="${resetLink}">Hacé clic acá para elegir una nueva contraseña</a></p><p>Este link expira en 30 minutos. Si no fuiste vos quien lo solicitó, podés ignorar este mensaje.</p>`,
      }).catch(() => {});
    }

    res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Controlador para restablecer la contraseña usando un token válido y no expirado.
 * La validación e invalidación del token ocurren en una única query atómica para que
 * dos requests concurrentes con el mismo token no puedan resetear la contraseña dos veces.
 */
export async function resetPasswordController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, password } = req.body;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const passwordHash = await bcrypt.hash(password, 10);

    const wasReset = await resetPasswordWithValidToken(tokenHash, passwordHash);
    if (!wasReset) {
      res.status(400).json({
        success: false,
        error: "InvalidTokenError",
        message: "El link de recuperación no es válido o expiró."
      });
      return;
    }

    res.status(200).json({ message: "Tu contraseña fue actualizada correctamente." });
  } catch (error: unknown) {
    next(error);
  }
}
