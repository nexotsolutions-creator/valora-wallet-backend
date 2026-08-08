import { Router } from "express";
import { depositController, exchangeController, getTransactionsController, buyController, sellController, quoteController } from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateSchema } from "../middlewares/validateSchema.js";
import { depositSchema, exchangeSchema, getTransactionsQuerySchema, quoteSchema } from "../schemas/transactionSchema.js";

export const transactionRouter = Router();

transactionRouter.post("/deposit", authMiddleware, validateSchema(depositSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), depositController);
transactionRouter.post("/quote", authMiddleware, validateSchema(quoteSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), quoteController);
transactionRouter.post("/exchange", authMiddleware, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), exchangeController);
transactionRouter.post("/buy", authMiddleware, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), buyController);
transactionRouter.post("/sell", authMiddleware, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), sellController);
transactionRouter.get("/", authMiddleware, validateSchema(getTransactionsQuerySchema, { errorCode: "VALIDATION_ERROR", includeIssues: true }, "query"), getTransactionsController);