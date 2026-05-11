import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import type { UserRole } from "../../core/types.js";

type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    role: UserRole;
  };
};

export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as { sub: string; role: UserRole };
    req.user = { sub: payload.sub, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

export const authorize = (roles: UserRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    next();
  };
