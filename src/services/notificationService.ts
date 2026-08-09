import { enviarEmailConfirmacion } from "./sesService.js";
import type { Transaction } from "../models/transactionModel.js";

/**
 * Envía un recibo por email de la transacción realizada.
 * @param email Correo electrónico del usuario
 * @param transaction Objeto de la transacción procesada
 */
export async function sendTransactionReceiptEmail(email: string, transaction: Transaction): Promise<void> {
    let asunto = "";
    let cuerpoHtml = "";

    const formatAmount = (amount: string | null) => amount ? parseFloat(amount).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

    const sourceAmount = formatAmount(transaction.source_amount);
    const targetAmount = formatAmount(transaction.target_amount);

    switch (transaction.transaction_type) {
        case "BUY":
            asunto = "Confirmación de Compra - Valora Wallet";
            cuerpoHtml = `
                <h2>¡Compra Exitosa!</h2>
                <p>Hola,</p>
                <p>Te confirmamos que hemos procesado tu compra de divisas correctamente.</p>
                <ul>
                    <li><strong>Monto Adquirido:</strong> ${targetAmount} ${transaction.target_currency}</li>
                    <li><strong>Costo (Referencia):</strong> ${formatAmount(transaction.exchange_rate)} ARS por unidad</li>
                </ul>
                <p>Gracias por confiar en Valora Wallet.</p>
            `;
            break;
        case "SELL":
            asunto = "Confirmación de Venta - Valora Wallet";
            cuerpoHtml = `
                <h2>¡Venta Exitosa!</h2>
                <p>Hola,</p>
                <p>Te confirmamos que hemos liquidado tus divisas correctamente.</p>
                <ul>
                    <li><strong>Monto Vendido:</strong> ${sourceAmount} ${transaction.source_currency}</li>
                    <li><strong>Recibido:</strong> ${targetAmount} ARS</li>
                </ul>
                <p>Gracias por confiar en Valora Wallet.</p>
            `;
            break;
        case "EXCHANGE":
            asunto = "Confirmación de Intercambio - Valora Wallet";
            cuerpoHtml = `
                <h2>¡Intercambio Exitoso!</h2>
                <p>Hola,</p>
                <p>Te confirmamos que tu intercambio de divisas se ha completado.</p>
                <ul>
                    <li><strong>Origen:</strong> ${sourceAmount} ${transaction.source_currency}</li>
                    <li><strong>Destino:</strong> ${targetAmount} ${transaction.target_currency}</li>
                </ul>
                <p>Gracias por confiar en Valora Wallet.</p>
            `;
            break;
        default:
            return;
    }

    await enviarEmailConfirmacion({
        destinatario: email,
        asunto,
        cuerpoHtml
    });
}
