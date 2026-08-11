import { z } from "zod";
import { emailRegex } from "../utils/emailValidation.js";
import { validarDocumento } from "../utils/documentValidation.js";
import { validarCelular } from "../utils/phoneValidation.js";

/**
 * Códigos ISO 3166-1 alpha-2 de los 19 países de LATAM soportados para país/documento.
 */
export const PAISES_LATAM = [
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "EC", "SV",
    "GT", "HN", "MX", "NI", "PA", "PY", "PE", "DO", "UY", "VE",
] as const;

/**
 * Validación cruzada compartida entre registro y "completar perfil": el DU y el celular
 * dependen del país elegido, así que no se pueden validar campo por campo de forma aislada.
 */
function duYCelularRefinement(
    data: { du: string; country: (typeof PAISES_LATAM)[number]; phone: string },
    ctx: z.RefinementCtx
): void {
    const { valido, label } = validarDocumento(data.du, data.country);
    if (!valido) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `El ${label} debe tener entre 5 y 15 caracteres alfanuméricos.`,
            path: ["du"],
        });
    }

    const celular = validarCelular(data.phone, data.country);
    if (!celular.valido) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "El número de celular provisto no es válido. Verificá que sea un celular (no línea fija) del país seleccionado.",
            path: ["phone"],
        });
    }
}

/**
 * Esquema de validación para el registro de usuarios
 */
export const registerSchema = z.object({
    email: z
        .string({ message: "El correo electrónico es requerido." })
        .trim()
        .toLowerCase()
        .refine((val) => emailRegex.test(val), {
            message: "El correo electrónico provisto no tiene un formato válido.",
        }),
    password: z
        .string({ message: "La contraseña es requerida." })
        .trim()
        .min(6, "La contraseña debe tener al menos 6 caracteres."),
    firstName: z
        .string({ message: "El nombre es requerido." })
        .trim()
        .min(2, "El nombre debe tener al menos 2 caracteres."),
    lastName: z
        .string({ message: "El apellido es requerido." })
        .trim()
        .min(2, "El apellido debe tener al menos 2 caracteres."),
    dateOfBirth: z
        .string({ message: "La fecha de nacimiento es requerida." })
        .trim()
        .regex(/^\d{2}\/\d{2}\/\d{4}$/, {
            message: "La fecha de nacimiento debe tener el formato DD/MM/YYYY",
        })
        .refine((val) => {
            // Si el formato no coincide con el regex, dejamos que la validación .regex maneje el error
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return true;
            const parts = val.split("/");
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // 0-indexed en JS Date
            const year = parseInt(parts[2], 10);
            
            const birthDateUTC = new Date(Date.UTC(year, month, day));
            if (isNaN(birthDateUTC.getTime())) return false;

            // Evitar desbordamientos de fecha del calendario (ej. 30 de febrero)
            if (
                birthDateUTC.getUTCFullYear() !== year ||
                birthDateUTC.getUTCMonth() !== month ||
                birthDateUTC.getUTCDate() !== day
            ) {
                return false;
            }

            const today = new Date();
            const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
            const cutoffUTC = new Date(Date.UTC(todayUTC.getUTCFullYear() - 18, todayUTC.getUTCMonth(), todayUTC.getUTCDate()));

            return birthDateUTC <= cutoffUTC;
        }, {
            message: "Debes ser mayor de 18 años para registrarte.",
        })
        .transform((val) => {
            // Transformar a YYYY-MM-DD para la base de datos
            const parts = val.split("/");
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }),
    phone: z
        .string({ message: "El número de teléfono es requerido." })
        .trim()
        .min(1, "El número de teléfono es requerido."),
    country: z.enum(PAISES_LATAM, {
        message: "El país provisto no está soportado.",
    }).default("AR"),
    du: z
        .string({ message: "El documento único es requerido." })
        .trim()
        .transform((val) => val.replace(/[\s.-]/g, "").toUpperCase()),
}).superRefine(duYCelularRefinement);

/**
 * Esquema para completar celular, país y DU luego del registro (ej. cuentas creadas
 * vía Google, que no piden estos datos en el alta). Reutiliza la misma validación
 * que el registro para no tener dos criterios distintos de "celular/DU válido".
 */
export const completeProfileSchema = z.object({
    phone: z
        .string({ message: "El número de teléfono es requerido." })
        .trim()
        .min(1, "El número de teléfono es requerido."),
    country: z.enum(PAISES_LATAM, {
        message: "El país provisto no está soportado.",
    }),
    du: z
        .string({ message: "El documento único es requerido." })
        .trim()
        .transform((val) => val.replace(/[\s.-]/g, "").toUpperCase()),
}).superRefine(duYCelularRefinement);

/**
 * Esquema de validación para el inicio de sesión
 */
export const loginSchema = z.object({
    email: z
        .string({ message: "El correo electrónico es requerido." })
        .trim()
        .toLowerCase()
        .refine((val) => emailRegex.test(val), {
            message: "El correo electrónico provisto no tiene un formato válido.",
        }),
    password: z
        .string({ message: "La contraseña es requerida." })
        .trim()
        .min(1, "La contraseña no puede estar vacía."),
});

/**
 * Esquema de validación para solicitar la recuperación de contraseña
 */
export const forgotPasswordSchema = z.object({
    email: z
        .string({ message: "El correo electrónico es requerido." })
        .trim()
        .toLowerCase()
        .refine((val) => emailRegex.test(val), {
            message: "El correo electrónico provisto no tiene un formato válido.",
        }),
});

/**
 * Esquema de validación para restablecer la contraseña con un token
 */
export const resetPasswordSchema = z.object({
    token: z
        .string({ message: "El token es requerido." })
        .trim()
        .min(1, "El token es requerido."),
    password: z
        .string({ message: "La contraseña es requerida." })
        .trim()
        .min(6, "La contraseña debe tener al menos 6 caracteres."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Esquema de validación para el inicio de sesión con Google
 */
export const googleLoginSchema = z.object({
    idToken: z
        .string({ message: "El idToken de Google es requerido." })
        .trim()
        .min(1, "El idToken no puede estar vacío."),
});

export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
