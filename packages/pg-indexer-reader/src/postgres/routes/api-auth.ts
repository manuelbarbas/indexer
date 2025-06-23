import Router from "@koa/router";
import { Middleware } from "koa";
import compose from "koa-compose";
import { Sql } from "postgres";
import { randomBytes } from "crypto";
import { Address, verifyMessage } from "viem";
import jwt from "jsonwebtoken";

import { debug, error } from "@/util/debug";
import { AuthTokenPayload } from "../middleware/authenticate"; 
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * API routes for authentication (nonce request and JWT verification).
 *
 * @param authDatabase - The database connection for authentication data.
 * @param jwtSecret - The secret for signing and verifying JWT tokens.
 * @returns The Koa middleware.
 */
export function apiAuth(authDatabase: Sql, jwtSecret: string): Middleware {
  const router = new Router();

  /**
   * GET /api/auth/nonce
   * Request a unique nonce for a given wallet address to sign.
   */
  router.get("/api/auth/nonce", async (ctx) => {
    const { address } = ctx.query;

    if (typeof address !== "string" || !address.startsWith("0x") || address.length !== 42) {
      ctx.status = 400;
      ctx.body = { error: "Invalid address provided." };
      return;
    }

    const walletAddress = address.toLowerCase() as Address;
    const nonce = randomBytes(16).toString("hex");

    try {
      await authDatabase`
        INSERT INTO auth (address, nonce, created_at)
        VALUES (${walletAddress}, ${nonce}, NOW())
        ON CONFLICT (address) DO UPDATE SET
          nonce = EXCLUDED.nonce,
          created_at = NOW();
      `;
      debug(`Upserted nonce for ${walletAddress} into auth DB: ${nonce}`);

      ctx.status = 200;
      ctx.body = { nonce };
    } catch (dbError: any) {
      error("Database error upserting nonce to auth DB:", dbError);
      ctx.status = 500;
      ctx.body = { error: "Internal server error: Could not generate nonce." };
    }
  });

  /**
   * POST /api/auth/verify
   * Verify the wallet signature of a nonce and issue a JWT.
   */
  router.post("/api/auth/verify", async (ctx) => {
    const { address, signature } = (ctx.request.body || {}) as { address?: string; signature?: `0x${string}` };

    if (!address || typeof address !== "string" || !address.startsWith("0x") || address.length !== 42 || !signature || typeof signature !== "string" || !signature.startsWith("0x")) {
      ctx.status = 400;
      ctx.body = { error: "Invalid address or signature provided." };
      return;
    }

    const walletAddress = address.toLowerCase() as Address;
    let storedNonceData: { nonce: string; created_at: Date } | undefined;

    try {
      const result = await authDatabase`
        SELECT nonce, created_at FROM auth WHERE address = ${walletAddress};
      `;

      if (result.length === 0) {
        ctx.status = 400;
        ctx.body = { error: "Nonce not found for this address. Please request a new one." };
        return;
      }
      storedNonceData = result[0] as { nonce: string; created_at: Date };

      const nonceTimestamp = storedNonceData.created_at.getTime();
      if (Date.now() - nonceTimestamp > NONCE_EXPIRY_MS) {
        await authDatabase`DELETE FROM auth WHERE address = ${walletAddress};`;
        ctx.status = 400;
        ctx.body = { error: "Nonce expired. Please request a new one." };
        return;
      }

      const messageToVerify = storedNonceData.nonce;

      const isValidSignature = await verifyMessage({
        address: walletAddress,
        message: messageToVerify,
        signature,
      });

      if (!isValidSignature) {
        ctx.status = 401;
        ctx.body = { error: "Signature verification failed: Invalid signature or address mismatch." };
        return;
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresInSeconds = 60 * 60 * 24 * 7;
      const expirationTime = issuedAt + expiresInSeconds;

      const tokenPayload: AuthTokenPayload = {
        sub: walletAddress,
        iat: issuedAt,
        exp: expirationTime,
      };

      const token = jwt.sign(tokenPayload, jwtSecret, { algorithm: "HS256" });

      await authDatabase`DELETE FROM auth WHERE address = ${walletAddress};`;
      console.log(`JWT issued for ${walletAddress}. Nonce deleted from auth DB.`);

      ctx.status = 200;
      ctx.body = { token, expiresIn: expiresInSeconds };
    } catch (e: any) {
      error("Server error during signature verification or auth DB operation:", e);
      ctx.status = 500;
      ctx.body = { error: "Internal server error during signature verification.", details: e.message };
    }
  });

  return compose([router.routes(), router.allowedMethods()]) as Middleware;
}