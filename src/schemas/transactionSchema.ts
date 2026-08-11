import { z } from "zod";

export const depositSchema = z.object({
  currency: z.string({ message: "La moneda es obligatoria." }).trim().min(1, "La moneda es obligatoria.").toUpperCase(),
  amount: z.number({ message: "El monto debe ser un número mayor a cero." }).positive("El monto debe ser un número mayor a cero."),
});
export const quoteSchema = z.object({
  fromCurrency: z.string({ message: "La moneda de origen es obligatoria." }).trim().min(1, "La moneda de origen es obligatoria.").toUpperCase(),
  toCurrency: z.string({ message: "La moneda de destino es obligatoria." }).trim().min(1, "La moneda de destino es obligatoria.").toUpperCase(),
  amount: z.number({ message: "El monto debe ser un número mayor a cero." }).positive("El monto debe ser un número mayor a cero."),
});

export const exchangeSchema = z.object({
  fromCurrency: z.string({ message: "La moneda de origen es obligatoria." }).trim().min(1, "La moneda de origen es obligatoria.").toUpperCase(),
  toCurrency: z.string({ message: "La moneda de destino es obligatoria." }).trim().min(1, "La moneda de destino es obligatoria.").toUpperCase(),
  amount: z.number({ message: "El monto debe ser un número mayor a cero." }).positive("El monto debe ser un número mayor a cero."),
});

export const getTransactionsQuerySchema = z.object({
  limit: z
    .preprocess((val) => {
      if (Array.isArray(val)) val = val[0];
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val === "string") {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? val : parsed;
      }
      return val;
    }, z.number({ message: "El límite debe ser un número entero." })
       .int("El límite debe ser un número entero.")
       .min(1, "El límite mínimo es 1.")
       .max(100, "El límite máximo es 100.")
       .optional())
    .default(20),
  page: z
    .preprocess((val) => {
      if (Array.isArray(val)) val = val[0];
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val === "string") {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? val : parsed;
      }
      return val;
    }, z.number({ message: "La página debe ser un número entero." })
       .int("La página debe ser un número entero.")
       .min(1, "La página mínima es 1.")
       .optional())
    .default(1),
  type: z
    .union([
      z.literal("BUY"),
      z.literal("SELL"),
      z.literal("EXCHANGE"),
      z.literal("DEPOSIT"),
    ], {
      message: "El tipo de transacción no es válido.",
    })
    .optional(),
});

export type GetTransactionsQuery = z.infer<typeof getTransactionsQuerySchema>;
