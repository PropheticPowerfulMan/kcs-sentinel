import cors from "cors";
import express from "express";
import { ZodError } from "zod";

import router from "./routes.js";

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use("/api", router);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ message: "Invalid request payload", issues: error.issues });
      return;
    }

    if (error instanceof Error) {
      res.status(500).json({ message: error.message });
      return;
    }

    res.status(500).json({ message: "Unexpected server error" });
  });

  return app;
};
