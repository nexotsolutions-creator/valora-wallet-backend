# 📂 1. ¿Qué archivos creaste y modificaste? (Tu mapa de trabajo)

Como encargado del motor financiero, trabajaste en toda la vertical de transacciones, saldos y cotizaciones. Esta es tu lista de archivos:

### Capa de Servicios (Core de tu Lógica de Negocio)
- **`src/services/exchangeRateService.ts`**: Integración con la API externa de Frankfurter y manejo de caché.
- **`src/services/transactionService.ts`**: Lógica transaccional ACID para depósitos y transferencias (Exchange).
- **`src/services/balanceService.ts`**: Lógica de inicialización perezosa (lazy) de saldos requeridos.

### Capa de Modelos (Interacción con PostgreSQL)
- **`src/models/transactionModel.ts`**: Inserción de registros inmutables en el ledger.
- **`src/models/balanceModel.ts`**: Consultas y actualizaciones de saldo con bloqueos de fila (`FOR UPDATE`).

### Capa de Controladores y Rutas (Tus Endpoints)
- **`src/controllers/transactionController.ts`**: Mapeo de datos (`snake_case` a `camelCase`) y orquestación de transacciones.
- **`src/controllers/balanceController.ts`**: Retorno de saldos del usuario.
- **`src/routes/transactionRoutes.ts`**: Endpoints `POST /transactions/deposit`, `POST /transactions/exchange` y `GET /transactions`.
- **`src/routes/balanceRoutes.ts`**: Endpoint `GET /balances`.
- **`src/schemas/transactionSchema.ts`**: Definición de los contratos para que el middleware de Santiago valide que los montos sean positivos.

### Pruebas y Documentación (Día 4)
- **`src/tests/exchange.test.ts`**: Pruebas de integración con Mocks (`vi.mock`) para simular la caída de la API de cotizaciones.
- **`src/tests/transactions.test.ts`**: Pruebas de tus unhappy paths (intentar operar sin saldo suficiente).
- **`docs/Endpoints.txt`**: Tu documentación técnica para el equipo y Frontend.

---

# 🧠 2. Detalle Técnico: ¿Por qué lo hiciste así? (Tu Defensa)

Si te preguntan por qué programaste las cosas de esta manera, esta es tu argumentación técnica:

- **Caché en Memoria y Alta Disponibilidad (Exchange)**: No consumes la API externa en cada petición porque agotarías la cuota (Rate Limiting) y harías la app muy lenta. Implementaste una caché en memoria (`ratesCache`) con un TTL de 1 hora. Además, aplicaste un patrón Fail-Fast y Fallback: si la API de divisas se cae, tu código devuelve la última caché válida guardada para que los usuarios puedan seguir operando sin bloqueos.

- **Transacciones ACID (Motor Financiero)**: Para depósitos e intercambios, usaste transacciones atómicas a nivel de base de datos (`BEGIN`, `COMMIT`, `ROLLBACK`). Esto garantiza que si se descuentan los dólares pero falla la acreditación de los euros, todo se revierte automáticamente, asegurando que la plata no se pierda ni se duplique.

- **Prevención de Race Conditions (Bloqueos)**: En `balanceModel.ts`, usaste el comando SQL `SELECT ... FOR UPDATE`. Esto bloquea la fila del saldo del usuario en la base de datos mientras dura la transacción matemática. Si el usuario hace doble clic rápido en "Intercambiar", el sistema no procesa ambas al mismo tiempo, previniendo que su saldo quede en negativo.

- **Principio de Retención Mínima de Recursos**: En tu `transactionService.ts`, pides la cotización a la API externa antes de abrir la conexión a la base de datos (`pool.connect()`). Si la API externa tarda en responder, no mantienes la base de datos bloqueada inútilmente.

- **Ledger Inmutable**: Diseñaste la lógica de transacciones para que solo inserte registros (`INSERT`) en la tabla `transactions`. Nunca se hace `UPDATE` ni `DELETE` sobre el historial de movimientos, para mantener una auditoría contable perfecta.

---

# 🔄 3. El Flujo Técnico End-to-End (Cómo funciona tu sistema)

Para tu exposición, el mejor endpoint para explicar es el **Exchange (Intercambio de divisas)**, ya que toca toda tu lógica. Así es el flujo paso a paso:

1. **Petición Inicial**: El Frontend de Gerardo envía un `POST` a `/transactions/exchange` con el body: `{ "fromCurrency": "USD", "toCurrency": "ARS", "amount": 100 }`.
2. **Filtros (Santiago)**: La petición pasa por el middleware de Auth de Santi (verifica que el token JWT sea válido) y por Zod (verifica que el monto sea un número mayor a cero).
3. **Cotización Temprana**: Tu controlador llama a `transactionService.ts`. Lo primero que haces es consultar a tu `exchangeRateService.ts` para obtener la tasa de conversión actualizada (desde tu caché o la API externa).
4. **Apertura Transaccional**: Con la tasa lista, pides un cliente a PostgreSQL (`pool.connect()`) e inicias una transacción segura con `BEGIN`.
5. **Validación de Negocio (Bloqueo)**: Consultas el saldo actual en USD usando `FOR UPDATE` para bloquear la fila. Verificas matemáticamente si el usuario tiene más de 100 USD. Si no los tiene, lanzas un error y haces `ROLLBACK`.
6. **Actualización de Saldos**: Si tiene fondos, usas tu función `updateUserBalance` aplicando un delta negativo (-100 a USD) y luego un delta positivo (los ARS equivalentes).
7. **Registro en el Ledger**: Insertar los detalles exactos (monedas, montos y tasa de cambio aplicada) en la tabla `transactions` para el historial.
8. **Respuesta Exitosa**: Haces `COMMIT` para guardar todo en la base de datos de Railway de forma permanente, liberas el cliente (`client.release()`), formateas las variables de `snake_case` a `camelCase` (para hacerle la vida fácil al Frontend) y respondes con un `200 OK`.