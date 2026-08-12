# Propuesta de PR: Estabilización y Seed Data

## Título del PR
`feat: estabilización del backend, parches de seguridad y seed data para demo`

## Descripción del PR

Este PR consolida las tareas de estabilización del backend e infraestructura necesarias para la demo final del proyecto.

### 🚀 Cambios Principales

#### 1. Parche Google OAuth
- Se eliminó el `NOT NULL` de la columna `du` en `users` (se mantiene `UNIQUE`).
- Esto permite registrar usuarios vía Google OAuth de manera atómica sin que la base de datos rebote la transacción (ya que Google no provee documento).
- Se añadió una migración explícita (`ALTER TABLE`) en `schema.sql` para no romper bases de datos ya existentes como la de Railway.

#### 2. Seguridad y JWT
- Se redujo el TTL (tiempo de expiración) de los JWT de `24h` a `15m` para mejorar la seguridad ante tokens comprometidos.
- Se actualizó la documentación (JSDoc) y la suite de pruebas unitarias.

#### 3. Script de Seed Data (`src/database/seed.ts`)
- Creado un script TypeScript para poblar la base de datos de manera limpia y consistente.
- **Fintech Ready:** Corre bajo una única transacción de base de datos (`BEGIN`/`COMMIT`/`ROLLBACK`).
- **Consistencia:** Genera de forma matemática e inmutable saldos e historiales de transacciones consistentes para 3 usuarios demo.
- **Seguridad:** El script es idempotente y el borrado está acotado estrictamente a correos `@valora.com` para no comprometer cuentas reales en Railway.
- **Formato:** CVU fijo de 22 caracteres y alias limpios de acentos.

#### 4. Documentación
- **README.md:** Actualizado con variables de entorno (`GOOGLE_CLIENT_ID`), comandos del seed y estructura de carpetas de este Sprint. Se eliminó la guía duplicada de endpoints.
- **CHANGELOG.md:** Agregada la versión `1.3.0` con todos los cambios y breaking changes (wallet object format) del Sprint 2.
- **Explicacion.md:** Corregidas referencias internas.

---

### 🧪 Verificación de Calidad
- **Tests:** Suite estabilizada con las nuevas validaciones de JWT (18 suites de pruebas y 100+ tests pasando en verde).
- **Ejecución exitosa:** El seed corre sin infringir ninguna regla o constraint de la base de datos remota.
