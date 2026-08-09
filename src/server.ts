import "dotenv/config";
import { app } from "./app.js";
import { initCronJobs } from "./services/cronService.js";

const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`🚀 Valora Wallet backend escuchando en: http://localhost:${port}`);
  initCronJobs();
});
