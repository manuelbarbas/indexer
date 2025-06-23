import { Middleware } from "koa";
import jwt from "jsonwebtoken";
import { Address } from "viem";
import { debug } from "@/util/debug";

// Define a type for your JWT payload
export interface AuthTokenPayload {
  sub: Address; // Subject: The wallet address
  iat: number; // Issued at
  exp: number; // Expiration time
}

/**
 * Koa middleware to verify JWT tokens and attach user info to ctx.state.
 *
 * @param jwtSecret The secret for signing and verifying JWT tokens.
 * @returns Koa middleware.
 */
export function authenticate(jwtSecret: string): Middleware {
  return async (ctx, next) => {
    const authHeader = ctx.get("Authorization");
    let authenticated = false;
    let walletAddress: Address | undefined;

    // console.log("Auth Check: Processing authHeader ", authHeader);

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, jwtSecret) as AuthTokenPayload;

        // console.log("Auth Check: Decoded JWT", decoded);

        if (decoded.sub) {
          walletAddress = decoded.sub;
          ctx.state.user = { id: walletAddress }; // Attach user info to ctx.state for downstream use
          authenticated = true;
          debug(`Auth Check: Bearer Token authenticated for ${walletAddress}`);
        } else {
          debug("Auth Check: Bearer Token valid, but missing subject (sub) claim.");
        }
      } catch (e: any) {
        debug("Auth Check: Invalid or expired Bearer Token", e.message);
      }
    }

    if (!authenticated) {
      ctx.status = 401;
      ctx.body = { error: "Unauthorized: Invalid or missing authentication token." };
      return;
    }

    await next();
  };
}