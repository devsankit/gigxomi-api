import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type PrismaGlobal = typeof globalThis & {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

function decodePrismaPostgresUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith("prisma+postgres://")) {
    return databaseUrl;
  }

  const parsed = new URL(databaseUrl);
  const apiKey = parsed.searchParams.get("api_key")?.trim();
  if (!apiKey) {
    throw new Error("DATABASE_URL is missing the Prisma Postgres api_key query parameter.");
  }

  const encodedPayload = apiKey.includes(".") ? apiKey.split(".")[1] : apiKey;
  if (!encodedPayload) {
    throw new Error("DATABASE_URL contains an invalid Prisma Postgres api_key payload.");
  }

  const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    databaseUrl?: string;
  };
  if (!decoded.databaseUrl?.trim()) {
    throw new Error("DATABASE_URL api_key did not include a direct databaseUrl.");
  }

  return decoded.databaseUrl.trim();
}

function getRuntimeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return decodePrismaPostgresUrl(databaseUrl);
}

function buildPoolConfig(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const isSupabasePooler = parsed.hostname.includes("pooler.supabase.com");

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: isSupabasePooler
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  };
}

const globalForPrisma = globalThis as PrismaGlobal;

function createPrismaClient() {
  const databaseUrl = getRuntimeDatabaseUrl();
  const pool =
    globalForPrisma.prismaPool ??
    new Pool({
      ...buildPoolConfig(databaseUrl),
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

  if (!globalForPrisma.prismaPool) {
    globalForPrisma.prismaPool = pool;
  }

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrismaClient() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;
