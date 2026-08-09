import { Request, Response } from "express";
import {
  createP2PRequestService,
  getMarketplaceService,
  acceptP2PRequestService,
  negotiateP2PRequestService,
  lockP2PTermsService,
  confirmP2PRequestService,
  cancelP2PRequestService
} from "../services/p2pService.js";

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email?: string; };
}

export const createP2PRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const { type, currencyFrom, currencyTo, amount, exchangeRate } = req.body;
    if (!type || !['BUY', 'SELL'].includes(type) || !currencyFrom || !currencyTo || !amount || !exchangeRate) {
      return res.status(400).json({ success: false, error: "Faltan parámetros requeridos o son inválidos." });
    }

    const request = await createP2PRequestService(userId, type, currencyFrom, currencyTo, amount, exchangeRate);
    res.status(201).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const getMarketplaceRequests = async (req: Request, res: Response) => {
  try {
    const requests = await getMarketplaceService();
    res.status(200).json({ success: true, data: requests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const acceptP2PRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const id = req.params.id as string;
    const request = await acceptP2PRequestService(userId, id);
    res.status(200).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const negotiateP2PRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const id = req.params.id as string;
    const { newAmount, newExchangeRate } = req.body;
    if (!newAmount || !newExchangeRate) {
      return res.status(400).json({ success: false, error: "Faltan parámetros de negociación." });
    }

    const request = await negotiateP2PRequestService(userId, id, newAmount, newExchangeRate);
    res.status(200).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const lockP2PTerms = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const id = req.params.id as string;
    const request = await lockP2PTermsService(userId, id);
    res.status(200).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const confirmP2PRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const id = req.params.id as string;
    const transferData = req.body;
    
    if (!transferData || Object.keys(transferData).length === 0) {
       return res.status(400).json({ success: false, error: "Los datos de la transferencia son requeridos (counterpartyName, etc)." });
    }

    const request = await confirmP2PRequestService(userId, id, transferData);
    res.status(200).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const cancelP2PRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "No autorizado." });

    const id = req.params.id as string;
    const request = await cancelP2PRequestService(userId, id);
    res.status(200).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};
