import { Readable } from "stream";
import Router from "@koa/router";
import { createBenchmark } from "@latticexyz/common";
import { Middleware } from "koa";
import compose from "koa-compose";
import { Sql } from "postgres";
import ratelimit from "koa-ratelimit";

import { queryLogs } from "@/postgres/queryLogs";
import { dbQuerySchema, filterSchema } from "@/postgres/querySchema";
import { toSQL } from "@/postgres/queryToSql";
import { compress } from "@/util/compress";
import { debug, error } from "@/util/debug";
import { recordToLog } from "@/util/recordToLog";


export function apiIndexer(database: Sql, apiKey: string): Middleware {
  const router = new Router();

  // Apply authentication middleware to all routes in this router
  router.use(async (ctx, next) => {
    if (ctx.path.startsWith("/api")) {
      const providedKey = ctx.get('x-api-key');
      if (!providedKey || providedKey !== apiKey) {
        ctx.status = 401;
        ctx.body = 'Unauthorized';
        return;
      }
    }
    await next();
  });

  const rateLimiter = ratelimit({
    driver: 'memory', // Consider Redis for production
    db: new Map(),
    duration: 60000, // 1 minute
    max: 100, // Max requests per minute
    id: (ctx) => ctx.state.user?.id || ctx.ip, // Limit by authenticated user ID (wallet address) or IP
    errorMessage: 'Too many requests. Please try again later.',
    disableHeader: false,
    headers: {
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
      total: 'X-RateLimit-Limit',
    },
  });

  router.use(rateLimiter);

  router.get("/api/logs", compress(), async (ctx) => {
    const benchmark = createBenchmark("postgres:logs");
    let options: ReturnType<typeof filterSchema.parse>;

    try {
      options = filterSchema.parse(typeof ctx.query.input === "string" ? JSON.parse(ctx.query.input) : {});
      console.log("Query options for /api/logs:", options);
    } catch (e) {
      ctx.status = 400;
      ctx.body = JSON.stringify({ error: "Invalid query input for logs", details: e });
      ctx.set("Content-Type", "application/json");
      debug(e);
      return;
    }

    try {
      options.filters = options.filters && options.filters.length > 0 ? [...options.filters] : [];

      const records = await queryLogs(database, options ?? {}).execute();
      benchmark("query records");

      if (records.length === 0) {
        ctx.status = 200;
        ctx.body =
          JSON.stringify({
            blockNumber: 0,
            chunk: 1,
            totalChunks: 1,
            logs: [],
          }) + "\n";
        return;
      }

      const blockNumber = records[0].chainBlockNumber;
      const logs = records.map(recordToLog);
      benchmark("map records to logs");

      const chunkSize = 1000;
      const chunks: (typeof logs)[] = [];
      for (let i = 0; i < logs.length; i += chunkSize) {
        const chunk = logs.slice(i, i + chunkSize);
        chunks.push(chunk);
      }

      const readableStream = new Readable({
        read() {
          chunks.forEach((chunk, index) => {
            this.push(
              JSON.stringify({
                blockNumber,
                chunk: index + 1,
                totalChunks: chunks.length,
                logs: chunk,
              }) + "\n",
            );
          });
          this.push(null);
        },
      });

      ctx.body = readableStream;
      ctx.status = 200;
    } catch (e) {
      ctx.status = 500;
      ctx.set("Content-Type", "application/json");
      ctx.body = JSON.stringify({ error: "Server error querying logs", details: e });
      error(e);
    }
  });

  router.get("/api/queryLogs", compress(), async (ctx) => {
    const benchmark = createBenchmark("postgres:logs");

    try {
      const input = dbQuerySchema.parse(typeof ctx.query.input === "string" ? JSON.parse(ctx.query.input) : {});
      const records = await toSQL(database, input.address, input.queries);
      benchmark("query records");

      if (records.length === 0) {
        ctx.status = 200;
        ctx.body =
          JSON.stringify({
            blockNumber: 0,
            chunk: 1,
            totalChunks: 1,
            logs: [],
          }) + "\n";
        return;
      }

      const blockNumber = records[0].chainBlockNumber;
      const logs = records.map(recordToLog);

      benchmark("map records to logs");

      const chunkSize = 1000;
      const chunks: (typeof logs)[] = [];
      for (let i = 0; i < logs.length; i += chunkSize) {
        const chunk = logs.slice(i, i + chunkSize);
        chunks.push(chunk);
      }

      const readableStream = new Readable({
        read() {
          chunks.forEach((chunk, index) => {
            this.push(
              JSON.stringify({
                blockNumber,
                chunk: index + 1,
                totalChunks: chunks.length,
                logs: chunk,
              }) + "\n",
            );
          });

          this.push(null);
        },
      });

      ctx.body = readableStream;
      ctx.status = 200;
    } catch (e: any) {
      ctx.status = 500;
      ctx.set("Content-Type", "application/json");
      ctx.body = JSON.stringify({ error: "Server error querying specific logs", details: e });
      debug(e);
      return;
    }

    ctx.status = 200;
  });

  return compose([router.routes(), router.allowedMethods()]) as Middleware;
}