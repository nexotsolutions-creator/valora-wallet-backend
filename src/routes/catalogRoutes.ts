import { Router } from "express";
import { getDocumentTypesController } from "../controllers/catalogController.js";

export const catalogRouter = Router();

// Público, sin auth: es data de referencia para armar el formulario de registro.
catalogRouter.get("/document-types", getDocumentTypesController);
