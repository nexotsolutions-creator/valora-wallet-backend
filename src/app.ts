import cors from "cors";
import express from "express";

import { errorHandler } from "./middlewares/errorHandler.js";
import { router } from "./routes/index.js";

export const app = express();

// Confía en el primer hop del proxy solo en producción (Railway agrega X-Forwarded-For
// delante de la app ahí). Fuera de producción no hay proxy real, así que dejarlo en false
// evita que cualquiera spoofee su IP vía ese header y evada el rate limiting.
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

const whitelist = ["http://localhost:5173"];
if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim() !== "") {
  whitelist.push(process.env.FRONTEND_URL.trim().replace(/\/$/, ""));
}

// Vercel genera una URL distinta por cada rama/preview del frontend (ej.
// valora-wallet-frontend-git-analia-nexo-tech-solutions.vercel.app), además
// de la de producción — un solo FRONTEND_URL fijo en el whitelist rechaza
// con 403 a cualquiera que no esté probando justo esa URL puntual.
// Confirmado con errores CORS reales en el log de Railway mientras el
// equipo testeaba desde distintas ramas.
// El regex EXIGE el team slug real ("nexo-tech-solutions") como sufijo fijo
// antes de ".vercel.app" — a propósito, no alcanza con que el dominio empiece
// con "valora-wallet-frontend": los nombres de proyecto en Vercel no están
// reservados globalmente, así que cualquiera podría registrar un proyecto
// propio con ese mismo prefijo. El team slug sí es único en todo Vercel, así
// que exigirlo es lo que realmente evita que un dominio de terceros cuele acá
// (encontrado en review de Copilot sobre la versión anterior de este regex).
const VERCEL_PREVIEW_PATTERN = /^https:\/\/valora-wallet-frontend-[a-z0-9-]+-nexo-tech-solutions\.vercel\.app$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalizedOrigin = origin.replace(/\/$/, "");
      if (whitelist.includes(normalizedOrigin) || VERCEL_PREVIEW_PATTERN.test(normalizedOrigin)) {
        callback(null, true);
      } else {
        const corsError = Object.assign(new Error("No permitido por CORS"), {
          status: 403,
          code: "CORS_ERROR",
        });
        callback(corsError);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

app.use(router);

app.use(errorHandler);
