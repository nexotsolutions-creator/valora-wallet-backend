import { pool } from "../database/db.js";
import { 
  createP2PRequest, 
  getP2PRequestById, 
  getMarketplaceRequests, 
  updateP2PRequestStatus 
} from "../models/p2pModel.js";
import { executeLockFunds, executeUnlockFunds } from "./balanceService.js";
import { findWalletByUserId } from "../models/walletModel.js";
import { getExchangeRates } from "./exchangeRateService.js";
import { insertTransaction } from "../models/transactionModel.js";

/**
 * Helper to validate that a proposed exchange rate does not deviate more than 10% from the official rate.
 */
async function validateExchangeRateMargin(currencyFrom: string, currencyTo: string, exchangeRate: number | string) {
  const pair = `${currencyFrom}_${currencyTo}`;
  let rates;
  try {
    rates = await getExchangeRates();
  } catch (error) {
    console.warn("[P2P Validation] APIs caídas y sin caché. Se omite validación temporal para no bloquear el sistema.", error);
    return;
  }

  const rateData = rates[pair];
  if (rateData) {
    const officialRate = rateData.value;
    const proposedRate = Number(exchangeRate);
    const deviation = Math.abs(proposedRate - officialRate) / officialRate;
    
    if (deviation > 0.10) {
      throw new Error(
        `La cotización propuesta (${proposedRate}) se desvía más del 10% permitido sobre el precio de mercado oficial (${officialRate.toFixed(2)}).`
      );
    }
  }
}

/**
 * Creates a new P2P request in the marketplace.
 * The funds are locked immediately in Escrow (PENDING state).
 */
export async function createP2PRequestService(
  creatorId: string,
  type: 'BUY' | 'SELL',
  currencyFrom: string,
  currencyTo: string,
  amount: number | string,
  exchangeRate: number | string
) {
  await validateExchangeRateMargin(currencyFrom, currencyTo, exchangeRate);
  await executeLockFunds(creatorId, currencyFrom, amount);

  const client = await pool.connect();
  try {
    const request = await createP2PRequest(client, creatorId, type, currencyFrom, currencyTo, amount, exchangeRate);
    return request;
  } finally {
    client.release();
  }
}

/**
 * Lists all pending requests in the marketplace.
 */
export async function getMarketplaceService() {
  return await getMarketplaceRequests();
}

/**
 * User B accepts a request to enter the negotiation phase.
 */
export async function acceptP2PRequestService(userId: string, requestId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await getP2PRequestById(requestId, client, true);
    if (!request) throw new Error("Solicitud no encontrada.");
    if (request.status !== "PENDING") throw new Error("La solicitud no está disponible.");
    if (request.creator_id === userId) throw new Error("No puedes aceptar tu propia solicitud.");

    const updated = await updateP2PRequestStatus(
      client, 
      requestId, 
      "NEGOTIATING", 
      userId
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Proposes a new amount or exchange rate during negotiation.
 */
export async function negotiateP2PRequestService(
  userId: string, 
  requestId: string, 
  newAmount: string | number, 
  newExchangeRate: string | number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await getP2PRequestById(requestId, client, true);
    if (!request) throw new Error("Solicitud no encontrada.");
    if (request.status !== "NEGOTIATING") throw new Error("La solicitud no está en negociación.");
    if (request.creator_id !== userId && request.acceptor_id !== userId) {
      throw new Error("No eres parte de esta negociación.");
    }

    // Validate 10% price deviation margin
    await validateExchangeRateMargin(request.currency_from, request.currency_to, newExchangeRate);

    const updated = await updateP2PRequestStatus(
      client,
      requestId,
      "NEGOTIATING",
      request.acceptor_id,
      newAmount,
      newExchangeRate
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Locks the terms. Both users must agree. 
 * Starts the 2-hour Escrow timer.
 */
export async function lockP2PTermsService(userId: string, requestId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await getP2PRequestById(requestId, client, true);
    if (!request) throw new Error("Solicitud no encontrada.");
    if (request.status !== "NEGOTIATING") throw new Error("La solicitud no está en negociación.");
    if (request.creator_id !== userId && request.acceptor_id !== userId) {
      throw new Error("No eres parte de esta negociación.");
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    const updated = await updateP2PRequestStatus(
      client,
      requestId,
      "LOCKED",
      request.acceptor_id,
      request.amount,
      request.exchange_rate,
      expiresAt
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cancels a negotiation. If it was NEGOTIATING, returns to PENDING.
 * If it was PENDING, it cancels it entirely and unlocks funds.
 */
export async function cancelP2PRequestService(userId: string, requestId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await getP2PRequestById(requestId, client, true);
    if (!request) throw new Error("Solicitud no encontrada.");

    if (request.status === "PENDING" && request.creator_id === userId) {
      await executeUnlockFunds(request.creator_id, request.currency_from, request.amount);
      const updated = await updateP2PRequestStatus(client, requestId, "DROPPED");
      await client.query("COMMIT");
      return updated;
    }

    if (request.status === "NEGOTIATING" && (request.creator_id === userId || request.acceptor_id === userId)) {
      const updated = await updateP2PRequestStatus(client, requestId, "PENDING", null); 
      await client.query("COMMIT");
      return updated;
    }

    throw new Error("No se puede cancelar esta solicitud.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Confirm execution of the request. Both parties must confirm.
 */
export async function confirmP2PRequestService(userId: string, requestId: string, transferData: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const request = await getP2PRequestById(requestId, client, true);
    if (!request) throw new Error("Solicitud no encontrada.");
    if (request.status !== "LOCKED") throw new Error("La solicitud no está lista para confirmación.");

    // Validate request inputs in transferData: destinationEmail, destinationWallet, amount, exchangeRate
    const { destinationEmail, destinationWallet, amount, exchangeRate } = transferData;
    if (!destinationEmail || !destinationWallet || amount === undefined || exchangeRate === undefined) {
      throw new Error("Datos de transferencia incompletos. Se requiere mail de destino, wallet de destino, monto y cotización.");
    }

    if (Number(amount) !== Number(request.amount)) {
      throw new Error("El monto provisto no coincide con el acordado.");
    }

    if (Number(exchangeRate) !== Number(request.exchange_rate)) {
      throw new Error("La cotización provista no coincide con la acordada.");
    }

    let counterpartyId = "";
    if (userId === request.creator_id) {
      counterpartyId = request.acceptor_id!;
    } else if (userId === request.acceptor_id) {
      counterpartyId = request.creator_id;
    } else {
      throw new Error("No eres parte de esta transacción.");
    }

    // Fetch counterparty details
    const counterpartyUserRes = await client.query(
      "SELECT email, first_name, last_name FROM users WHERE id = $1",
      [counterpartyId]
    );
    if (counterpartyUserRes.rows.length === 0) {
      throw new Error("No se encontró el usuario contraparte.");
    }
    const counterpartyUser = counterpartyUserRes.rows[0];
    const counterpartyEmail = counterpartyUser.email;
    const counterpartyName = `${counterpartyUser.first_name} ${counterpartyUser.last_name}`;

    const counterpartyWalletRes = await client.query(
      "SELECT id FROM wallets WHERE user_id = $1",
      [counterpartyId]
    );
    if (counterpartyWalletRes.rows.length === 0) {
      throw new Error("No se encontró la billetera de la contraparte.");
    }
    const counterpartyWalletId = counterpartyWalletRes.rows[0].id;

    // Validate mail and wallet
    if (destinationEmail !== counterpartyEmail) {
      throw new Error("El email de destino no coincide con el de la contraparte.");
    }
    if (destinationWallet !== counterpartyWalletId) {
      throw new Error("La billetera de destino no coincide con la de la contraparte.");
    }

    let creatorConfirmed = request.creator_confirmed;
    let acceptorConfirmed = request.acceptor_confirmed;
    let creatorData = request.creator_data;
    let acceptorData = request.acceptor_data;

    if (userId === request.creator_id) {
      creatorConfirmed = true;
      creatorData = transferData;
    } else {
      acceptorConfirmed = true;
      acceptorData = transferData;
    }

    let newStatus = "LOCKED";
    if (creatorConfirmed && acceptorConfirmed) {
      newStatus = "COMPLETED";

      // 1. Resolve Creator Wallet and unlock funds
      const creatorWallet = await findWalletByUserId(request.creator_id, client);
      if (!creatorWallet) throw new Error("Billetera del creador no encontrada.");

      const { unlockFunds } = await import("../models/balanceModel.js");
      await unlockFunds(client, creatorWallet.id, request.currency_from, request.amount);

      // 2. Transfer logic
      const targetAmount = Number(request.amount) * Number(request.exchange_rate);

      // Deduct from Creator
      await client.query(
        "UPDATE balances SET amount = amount - $3, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $1 AND currency_code = $2",
        [creatorWallet.id, request.currency_from, request.amount]
      );
      // Add to Creator and retrieve resulting balance
      const creatorTargetBalanceRes = await client.query(
        "INSERT INTO balances (wallet_id, currency_code, amount) VALUES ($1, $2, $3) ON CONFLICT (wallet_id, currency_code) DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP RETURNING amount",
        [creatorWallet.id, request.currency_to, targetAmount]
      );
      const creatorResultingBalance = creatorTargetBalanceRes.rows[0].amount;

      // Resolve Acceptor Wallet
      const acceptorWallet = await findWalletByUserId(request.acceptor_id!, client);
      if (!acceptorWallet) throw new Error("Billetera del aceptador no encontrada.");

      // Deduct from Acceptor
      await client.query(
        "UPDATE balances SET amount = amount - $3, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $1 AND currency_code = $2",
        [acceptorWallet.id, request.currency_to, targetAmount]
      );
      // Add to Acceptor and retrieve resulting balance
      const acceptorTargetBalanceRes = await client.query(
        "INSERT INTO balances (wallet_id, currency_code, amount) VALUES ($1, $2, $3) ON CONFLICT (wallet_id, currency_code) DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP RETURNING amount",
        [acceptorWallet.id, request.currency_from, request.amount]
      );
      const acceptorResultingBalance = acceptorTargetBalanceRes.rows[0].amount;

      // Fetch creator's user details for acceptor's transaction log
      const creatorUserRes = await client.query(
        "SELECT email, first_name, last_name FROM users WHERE id = $1",
        [request.creator_id]
      );
      const creatorUser = creatorUserRes.rows[0];
      const creatorName = `${creatorUser.first_name} ${creatorUser.last_name}`;

      // 3. Create historical records in transactions table using insertTransaction helper
      // Transaction for Creator
      await insertTransaction(
        client,
        creatorWallet.id,
        request.type,
        request.currency_from,
        request.currency_to,
        request.amount,
        targetAmount,
        request.exchange_rate,
        creatorResultingBalance,
        request.acceptor_id,
        counterpartyName,
        counterpartyEmail,
        counterpartyWalletId
      );

      // Transaction for Acceptor
      await insertTransaction(
        client,
        acceptorWallet.id,
        request.type === 'BUY' ? 'SELL' : 'BUY',
        request.currency_to,
        request.currency_from,
        targetAmount,
        request.amount,
        request.exchange_rate,
        acceptorResultingBalance,
        request.creator_id,
        creatorName,
        creatorUser.email,
        creatorWallet.id
      );
    }

    const updated = await updateP2PRequestStatus(
      client,
      requestId,
      newStatus,
      request.acceptor_id,
      request.amount,
      request.exchange_rate,
      request.expires_at ? new Date(request.expires_at) : null,
      creatorConfirmed,
      acceptorConfirmed,
      creatorData,
      acceptorData
    );
    
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
