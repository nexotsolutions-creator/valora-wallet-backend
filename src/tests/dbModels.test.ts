import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query } from "../database/db";
import { createOrUpdateBalance, findBalanceByWalletAndCurrency, findBalancesByWalletId, getUserBalance, updateUserBalance } from "../models/balanceModel";
import { createUser, findUserByEmail, findUserById } from "../models/userModel";
import { createWallet, findWalletByUserId } from "../models/walletModel";

describe("Pruebas de integración de modelos de base de datos", () => {
  const testEmail = "test_santiago@valora.com";
  let createdUserId: string;
  let createdWalletId: string;

  // Limpieza inicial antes de ejecutar las pruebas
  beforeAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testEmail]);
  });

  // Limpieza final de la base de datos
  afterAll(async () => {
    await query("DELETE FROM users WHERE email = $1", [testEmail]);
  });

  describe("Pruebas del modelo de Usuario", () => {
    it("debería registrar un nuevo usuario exitosamente en la base de datos", async () => {
      const user = await createUser(testEmail, "clave_encriptada_valora", "Santiago", "Chavez", "1995-05-15", "+5491123456789", "AR", "66666666");
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testEmail);
      expect(user.first_name).toBe("Santiago");
      expect(user.last_name).toBe("Chavez");
      expect(user.date_of_birth).toBeDefined();
      expect(user.phone).toBe("+5491123456789");
      createdUserId = user.id;
    });

    it("debería recuperar un usuario por su identificador único", async () => {
      const user = await findUserById(createdUserId);
      expect(user).not.toBeNull();
      expect(user!.email).toBe(testEmail);
    });

    it("debería encontrar un usuario utilizando su dirección de correo", async () => {
      const user = await findUserByEmail(testEmail);
      expect(user).not.toBeNull();
      expect(user!.id).toBe(createdUserId);
    });
  });

  describe("Pruebas del modelo de Billetera", () => {
    it("debería crear una billetera asociada al usuario de forma exitosa", async () => {
      const wallet = await createWallet(createdUserId, "Santiago");
      expect(wallet.id).toBeDefined();
      expect(wallet.user_id).toBe(createdUserId);
      createdWalletId = wallet.id;
    });

    it("debería encontrar la billetera por el identificador de usuario", async () => {
      const wallet = await findWalletByUserId(createdUserId);
      expect(wallet).not.toBeNull();
      expect(wallet!.id).toBe(createdWalletId);
    });
  });

  describe("Pruebas del modelo de Saldo", () => {
    it("debería crear un saldo de 1500 USD para la billetera", async () => {
      const balance = await createOrUpdateBalance(createdWalletId, "USD", "1500.00000000");
      expect(balance.id).toBeDefined();
      expect(balance.wallet_id).toBe(createdWalletId);
      expect(balance.currency_code).toBe("USD");
      expect(parseFloat(balance.amount)).toBe(1500);
    });

    it("debería obtener un saldo específico por su código de moneda", async () => {
      const balance = await findBalanceByWalletAndCurrency(createdWalletId, "USD");
      expect(balance).not.toBeNull();
      expect(balance!.currency_code).toBe("USD");
      expect(parseFloat(balance!.amount)).toBe(1500);
    });

    it("debería listar todos los saldos pertenecientes a la billetera", async () => {
      await createOrUpdateBalance(createdWalletId, "ARS", "450000.50000000");
      const balances = await findBalancesByWalletId(createdWalletId);
      expect(balances.length).toBe(2);

      const usdBalance = balances.find((b) => b.currency_code === "USD");
      const arsBalance = balances.find((b) => b.currency_code === "ARS");

      expect(usdBalance).toBeDefined();
      expect(arsBalance).toBeDefined();
      expect(parseFloat(usdBalance!.amount)).toBe(1500);
      expect(parseFloat(arsBalance!.amount)).toBe(450000.5);
    });

    it("debería actualizar un saldo existente si ocurre un conflicto", async () => {
      const updatedBalance = await createOrUpdateBalance(createdWalletId, "USD", "1850.75000000");
      expect(parseFloat(updatedBalance.amount)).toBe(1850.75);

      const retrieved = await findBalanceByWalletAndCurrency(createdWalletId, "USD");
      expect(parseFloat(retrieved!.amount)).toBe(1850.75);
    });

    it("debería leer el saldo desde la transacción activa cuando existe un cambio no comprometido", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const updatedBalance = await updateUserBalance(client, createdWalletId, "USD", 100);
        const balanceInTransaction = await getUserBalance(createdUserId, "USD", client);

        expect(parseFloat(updatedBalance.amount)).toBe(1950.75);
        expect(balanceInTransaction).toBe(1950.75);

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });
});
