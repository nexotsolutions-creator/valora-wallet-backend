import { getExpiredLockedRequests, updateP2PRequestStatus } from "../models/p2pModel.js";
import { executeUnlockFunds } from "./balanceService.js";
import { pool } from "../database/db.js";

/**
 * Escanea la base de datos buscando transacciones P2P en estado LOCKED que hayan expirado.
 * Las transacciones expiradas se marcan como FAILED y los fondos se liberan.
 */
export async function scanExpiredP2PRequests() {
  try {
    const expiredRequests = await getExpiredLockedRequests();
    
    for (const req of expiredRequests) {
      console.log(`[CRON] Solicitud P2P expirada encontrada: ${req.id}`);
      
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        
        // Descongelar los fondos del creador
        await executeUnlockFunds(req.creator_id, req.currency_from, req.amount);
        
        // Marcar la solicitud como FAILED
        await updateP2PRequestStatus(client, req.id, "FAILED");
        
        await client.query("COMMIT");
        console.log(`[CRON] Solicitud ${req.id} cancelada y fondos liberados.`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`[CRON] Error al cancelar solicitud ${req.id}:`, error);
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error("[CRON] Error al buscar solicitudes expiradas:", error);
  }
}

/**
 * Inicializa el Cron Job de limpieza de transacciones P2P
 */
export function initCronJobs() {
  // Ejecutar cada 5 minutos
  setInterval(() => {
    scanExpiredP2PRequests();
  }, 5 * 60 * 1000);
  
  console.log("⏰ Cron Jobs inicializados (Limpieza P2P cada 5 min).");
}
