import { PrismaClient } from "./generated/prisma/client.js";
import { buildApp } from "./app.js";

const prisma = new PrismaClient();
const app = buildApp(prisma);

const port = Number(process.env.PORT ?? 3001);
app.listen({ port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
