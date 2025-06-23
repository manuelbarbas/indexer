#!/usr/bin/env node

import "dotenv/config";

import cors from "@koa/cors";
import Router from "@koa/router";
import Koa from "koa";
import bodyParser from "@koa/bodyparser";
import postgres from "postgres";
import { z } from "zod";

import { frontendEnvSchema, parseEnv, serverEnvSchema } from "@bin/parseEnv";
import { apiIndexer } from "@/postgres/routes/api-indexer";
import { apiAuth } from "@/postgres/routes/api-auth";
//import { httpsEnvSchema } from "@/utils/envSchema";

const env = parseEnv(serverEnvSchema);


const indexerDatabase = postgres(env.INDEXER_DATABASE_URL, {
  prepare: false,
});
console.log("Connected to Primodium Indexer Database (Digital Ocean).");

const authDatabase = postgres(env.AUTH_DATABASE_URL, {
  prepare: false,
});
console.log("Connected to Auth Database (Render PostgreSQL).");

const server = new Koa();

server.use(cors());
server.use(bodyParser());

server.use(apiAuth(authDatabase, env.JWT_SECRET));
server.use(apiIndexer(indexerDatabase, env.JWT_SECRET));

const router = new Router();

router.get("/", (ctx) => {
  ctx.body = "emit Herld(); ";
});

// k8s healthchecks
router.get("/healthz", (ctx) => {
  ctx.status = 200;
});
router.get("/readyz", (ctx) => {
  ctx.status = 200;
});

server.use(router.routes());
server.use(router.allowedMethods());

server.listen({ host: env.INDEXER_HOST, port: env.INDEXER_PORT });
console.log(`postgres indexer frontend listening on http://${env.INDEXER_HOST}:${env.INDEXER_PORT}`);
