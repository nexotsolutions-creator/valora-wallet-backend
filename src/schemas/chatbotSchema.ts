import { z } from "zod";

/**
 * Esquema de validación para los mensajes del chatbot
 */
export const chatbotMessageSchema = z.object({
    message: z
        .string({ message: "El mensaje debe ser texto." })
        .trim()
        .min(1, "El mensaje es requerido.")
        .max(1000, "El mensaje es demasiado largo (máximo 1000 caracteres)."),
    history: z.array(
        z.object({
            role: z.enum(["user", "model"]),
            parts: z.array(z.object({ text: z.string() }))
        })
    ).optional()
});
