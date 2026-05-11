import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import type { UserRole } from "../../core/types.js";

export const issueDemoToken = (role: UserRole) =>
  jwt.sign(
    {
      sub: `demo-${role}`,
      role,
      scope: ["attendance:read", "attendance:write", "analytics:read"]
    },
    env.jwtSecret,
    { expiresIn: "12h" }
  );
