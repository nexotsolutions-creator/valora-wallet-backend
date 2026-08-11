import type { Request, Response } from "express";
import { DOCUMENTO_POR_PAIS } from "../utils/documentValidation.js";

/**
 * Devuelve el mapa completo de tipos de documento por país, para que el front sepa
 * qué label mostrar según el país que el usuario ya eligió en el selector de celular.
 */
export function getDocumentTypesController(_req: Request, res: Response): void {
  res.status(200).json({ success: true, data: DOCUMENTO_POR_PAIS });
}
