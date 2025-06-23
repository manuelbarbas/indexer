import { isHex } from "viem";
import { z, ZodError, ZodTypeAny } from "zod";

// Host and port the indexer is listening on
export const frontendEnvSchema = z.object({
  INDEXER_HOST: z.string().default("0.0.0.0"),
  INDEXER_PORT: z.coerce.number().positive().default(3001),
});

export const httpsEnvSchema = z.object({
  HTTPS_ENABLED: z.coerce.boolean().default(false),
  HTTPS_KEY_PATH: z.string().optional(),
  HTTPS_CERT_PATH: z.string().optional(),
}).optional();

export const serverEnvSchema = z.intersection(
  frontendEnvSchema,
  z.object({
    INDEXER_DATABASE_URL: z.string().min(1), // Required for Primodium Indexer DB
    AUTH_DATABASE_URL: z.string().min(1),    // Required for Auth DB (Render)
    JWT_SECRET: z.string().min(1),           // Required for JWTs
  }).and(httpsEnvSchema || z.object({})) // Merge HTTPS schema if it exists, or an empty object
);



// Parse and validate the environment variables
export function parseEnv<TSchema extends ZodTypeAny>(envSchema: TSchema): z.infer<TSchema> {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof ZodError) {
      const { _errors, ...invalidEnvVars } = error.format();
      console.error(`\nMissing or invalid environment variables:\n\n  ${Object.keys(invalidEnvVars).join("\n  ")}\n`);
      process.exit(1);
    }
    throw error;
  }
}
