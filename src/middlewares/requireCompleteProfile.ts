import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { findUserById } from "../models/userModel.js";
import { DOCUMENTO_POR_PAIS } from "../utils/documentValidation.js";

/**
 * Bloquea operaciones de billetera (depositar, comprar, vender, intercambiar) hasta que
 * la cuenta tenga celular y DU cargados. Necesario sobre todo para cuentas de Google, que
 * arrancan sin esos datos: sin DU no hay forma de garantizar que una persona no abra dos
 * cuentas. Se aplica ruta por ruta en transactionRoutes.ts (no en /quote, que es de solo
 * lectura). Requiere que authMiddleware haya corrido antes (usa req.user.userId).
 */
export async function requireCompleteProfile(
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

    if (!user.phone || !user.du) {
      // El label del documento varía por país (CPF, CURP, CI, etc.) — "DNI" a secas
      // solo es correcto para Argentina.
      const documentoLabel = DOCUMENTO_POR_PAIS[user.country] ?? "documento de identidad";
      res.status(403).json({
        success: false,
        error: "IncompleteProfileError",
        message: `Completá tu celular y tu ${documentoLabel} antes de operar con tu billetera.`,
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
