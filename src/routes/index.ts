import { Router } from "express";
import { authRouter } from "./authRoutes.js";
import { transactionRouter } from "./transactionRoutes.js";
import { balanceRouter } from "./balanceRoutes.js";
import { chatbotRouter } from "./chatbotRoutes.js";
import p2pRoutes from "./p2pRoutes.js";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRouter);
router.use("/transactions", transactionRouter);
router.use("/balances", balanceRouter);
router.use("/chatbot", chatbotRouter);
router.use("/p2p", p2pRoutes);