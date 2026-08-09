import { Router } from "express";
import { depositController, exchangeController, getTransactionsController, buyController, sellController, quoteExchangeController, quoteBuyController, quoteSellController } from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateSchema } from "../middlewares/validateSchema.js";
import { depositSchema, exchangeSchema, getTransactionsQuerySchema, quoteExchangeSchema, quoteBuySellSchema, buySellSchema } from "../schemas/transactionSchema.js";

export const transactionRouter = Router();

transactionRouter.post("/deposit", authMiddleware, validateSchema(depositSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), depositController);
transactionRouter.post("/quote/exchange", authMiddleware, validateSchema(quoteExchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), quoteExchangeController);
transactionRouter.post("/quote/buy", authMiddleware, validateSchema(quoteBuySellSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), quoteBuyController);
transactionRouter.post("/quote/sell", authMiddleware, validateSchema(quoteBuySellSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), quoteSellController);
transactionRouter.post("/exchange", authMiddleware, validateSchema(exchangeSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), exchangeController);
transactionRouter.post("/buy", authMiddleware, validateSchema(buySellSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), buyController);
transactionRouter.post("/sell", authMiddleware, validateSchema(buySellSchema, { errorCode: "VALIDATION_ERROR", includeIssues: false }), sellController);
transactionRouter.get("/", authMiddleware, validateSchema(getTransactionsQuerySchema, { errorCode: "VALIDATION_ERROR", includeIssues: true }, "query"), getTransactionsController);