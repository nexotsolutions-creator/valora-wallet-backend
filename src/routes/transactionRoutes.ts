import { Router } from "express";
import { depositController, exchangeController, getTransactionsController, buyController, sellController, quoteController } from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { requireCompleteProfile } from "../middlewares/requireCompleteProfile.js";
import { validateSchema } from "../middlewares/validateSchema.js";
import { depositSchema, exchangeSchema, getTransactionsQuerySchema, quoteSchema } from "../schemas/transactionSchema.js";

export const transactionRouter = Router();

// requireCompleteProfile solo va en las operaciones que mueven plata (depositar, comprar,
// vender, intercambiar) — no en /quote (cotizar es de solo lectura, no hace falta tener
// el perfil completo para consultar precio) ni en el listado de transacciones.
transactionRouter.post("/deposit", authMiddleware, requireCompleteProfile, validateSchema(depositSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), depositController);
transactionRouter.post("/quote", authMiddleware, validateSchema(quoteSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), quoteController);
transactionRouter.post("/exchange", authMiddleware, requireCompleteProfile, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), exchangeController);
transactionRouter.post("/buy", authMiddleware, requireCompleteProfile, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), buyController);
transactionRouter.post("/sell", authMiddleware, requireCompleteProfile, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), sellController);
transactionRouter.get("/", authMiddleware, validateSchema(getTransactionsQuerySchema, { errorCode: "VALIDATION_ERROR", includeIssues: true }, "query"), getTransactionsController);