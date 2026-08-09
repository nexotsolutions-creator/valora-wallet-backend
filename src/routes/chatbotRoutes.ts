import { Router } from "express";
import { chatController } from "../controllers/chatbotController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

import { validateSchema } from "../middlewares/validateSchema.js";
import { chatbotMessageSchema } from "../schemas/chatbotSchema.js";

export const chatbotRouter = Router();

// Endpoint protegido para enviar mensajes al asistente
chatbotRouter.post(
    "/message",
    authMiddleware,
    validateSchema(chatbotMessageSchema, { errorCode: "VALIDATION_ERROR", includeIssues: true }),
    chatController
);