import request from "supertest";
import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from "vitest";
import { query } from "../database/db.js";

// Mockeamos el servicio de IA para evitar llamadas reales a la API
vi.mock("../services/aiService.js", () => {
    return {
        getFinancialAdvice: vi.fn().mockResolvedValue("Mocked AI response")
    };
});

describe("Pruebas de integración del Chatbot", () => {
    let app: typeof import("../app.js").app;
    let getFinancialAdvice: typeof import("../services/aiService.js").getFinancialAdvice;
    let token = "";
    const testUser = {
        email: "chatbot_test@valora.com",
        password: "PasswordSegura123!",
        firstName: "Chatbot",
        lastName: "Test",
        dateOfBirth: "01/01/1990",
        phone: "+54 9 351 111-2222",
    };

    beforeAll(async () => {
        const appModule = await import("../app.js");
        const aiModule = await import("../services/aiService.js");
        app = appModule.app;
        getFinancialAdvice = aiModule.getFinancialAdvice;

        await query("DELETE FROM users WHERE email = $1", [testUser.email]);

        const res = await request(app).post("/auth/register").send(testUser);
        token = res.body.token;
    });

    afterAll(async () => {
        await query("DELETE FROM users WHERE email = $1", [testUser.email]);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("POST /chatbot/message", () => {
        it("debería retornar 401 si no se envía el header de Authorization", async () => {
            const response = await request(app)
                .post("/chatbot/message")
                .send({ message: "Hola" });

            expect(response.status).toBe(401);
            expect(response.body).toEqual({
                success: false,
                error: "UnauthorizedError",
                message: "Acceso no autorizado. Token no proporcionado.",
            });
        });

        it("debería retornar 400 si falta el campo 'message' en el body", async () => {
            const response = await request(app)
                .post("/chatbot/message")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                success: false,
                error: "VALIDATION_ERROR",
                message: expect.any(String),
                issues: expect.any(Array),
            });
        });

        it("debería retornar 200 y la respuesta de la IA al enviar un mensaje válido", async () => {
            const message = "¿Cuánto saldo tengo?";
            const response = await request(app)
                .post("/chatbot/message")
                .set("Authorization", `Bearer ${token}`)
                .send({ message });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.reply).toBe("Mocked AI response");
            
            // Verificamos que el controlador inyecte los saldos y llame al servicio de IA
            expect(vi.mocked(getFinancialAdvice)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(getFinancialAdvice)).toHaveBeenCalledWith(
                message, 
                expect.objectContaining({
                    USD: expect.any(Number),
                    EUR: expect.any(Number),
                    ARS: expect.any(Number)
                }),
                expect.any(Object), // rates
                expect.any(Array)   // history
            );
        });
    });
});

