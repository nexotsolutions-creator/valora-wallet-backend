import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import {
  createP2PRequest,
  getMarketplaceRequests,
  acceptP2PRequest,
  negotiateP2PRequest,
  lockP2PTerms,
  confirmP2PRequest,
  cancelP2PRequest
} from "../controllers/p2pController.js";

const router = Router();

// Get all pending requests in the marketplace
router.get("/requests", authMiddleware, getMarketplaceRequests);

// Create a new P2P request
router.post("/requests", authMiddleware, createP2PRequest);

// Accept a request (User B enters negotiation)
router.post("/requests/:id/accept", authMiddleware, acceptP2PRequest);

// Propose new negotiation terms
router.put("/requests/:id/negotiate", authMiddleware, negotiateP2PRequest);

// Lock terms and funds
router.post("/requests/:id/lock", authMiddleware, lockP2PTerms);

// Confirm transaction (Bidirectional)
router.post("/requests/:id/confirm", authMiddleware, confirmP2PRequest);

// Cancel transaction
router.post("/requests/:id/cancel", authMiddleware, cancelP2PRequest);

export default router;
