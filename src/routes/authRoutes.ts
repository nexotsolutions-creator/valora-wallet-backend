import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  registerController,
  loginController,
  meController,
  completeProfileController,
  logoutController,
  googleLoginController,
  forgotPasswordController,
  resetPasswordController,
} from "../controllers/authController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateSchema } from "../middlewares/validateSchema.js";
import { registerSchema, loginSchema, completeProfileSchema, googleLoginSchema, forgotPasswordSchema, resetPasswordSchema } from "../schemas/authSchema.js";

export const authRouter = Router();

// Limita los pedidos de recuperación de contraseña por IP para evitar que se agote
// la cuota de envío de AWS SES (el endpoint no requiere autenticación).
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "TooManyRequestsError",
    message: "Demasiados intentos. Probá de nuevo más tarde.",
  },
});

authRouter.post("/register", validateSchema(registerSchema), registerController);
authRouter.post("/login", validateSchema(loginSchema), loginController);
authRouter.get("/me", authMiddleware, meController);
authRouter.patch("/me", authMiddleware, validateSchema(completeProfileSchema), completeProfileController);
authRouter.post("/logout", authMiddleware, logoutController);
authRouter.post("/google", validateSchema(googleLoginSchema), googleLoginController);
authRouter.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validateSchema(forgotPasswordSchema),
  forgotPasswordController
);
authRouter.post("/reset-password", validateSchema(resetPasswordSchema), resetPasswordController);
