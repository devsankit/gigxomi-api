import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "postgresql://gigxomi_user:gigxomi_secure_password_2026@127.0.0.1:5432/gigxomi?schema=public";
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runTests() {
  console.log("=== Gigxomi Team Portfolio API Automated Test Suite ===\n");

  const baseUrl = "http://127.0.0.1:3003";
  const proxyUrl = "http://127.0.0.1:3002";
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passedCount++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failedCount++;
    }
  }

  // Find a valid tenant in DB
  const sampleTenant = await prisma.tenant.findFirst({
    select: { id: true, name: true, slug: true },
  });

  const tenantId = sampleTenant?.id || "tenant-agency-408de269";
  console.log(`Using Tenant: ${tenantId} (${sampleTenant?.name || "Agency Workspace"})\n`);

  // Test 1: Unauthenticated request should return 401
  console.log("Test 1: Unauthenticated request rejection");
  const res1 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`);
  const data1 = await res1.json();
  assert(res1.status === 401, `Status is 401 Unauthorized (got ${res1.status})`);
  assert(data1.success === false, "success is false");
  assert(data1.code === "UNAUTHORIZED", "Error code is UNAUTHORIZED");

  // Test 2: Invalid bearer token should return 401
  console.log("\nTest 2: Invalid Bearer token rejection");
  const res2 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    headers: { Authorization: "Bearer gx_tp_live_invalidtoken1234567890abcdef" },
  });
  const data2 = await res2.json();
  assert(res2.status === 401, `Status is 401 Unauthorized (got ${res2.status})`);
  assert(data2.success === false, "success is false");

  // Test 3: CORS Preflight validation
  console.log("\nTest 3: CORS Headers for allowed and disallowed origins");
  const corsAllowed1 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    method: "OPTIONS",
    headers: { Origin: "https://agency.gigxomi.com" },
  });
  assert(
    corsAllowed1.headers.get("access-control-allow-origin") === "https://agency.gigxomi.com",
    "Origin https://agency.gigxomi.com is allowed",
  );

  const corsAllowed2 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3020" },
  });
  assert(
    corsAllowed2.headers.get("access-control-allow-origin") === "http://localhost:3020",
    "Origin http://localhost:3020 is allowed",
  );

  const corsBlocked = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    method: "OPTIONS",
    headers: { Origin: "https://unauthorized-site.com" },
  });
  assert(
    !corsBlocked.headers.get("access-control-allow-origin"),
    "Disallowed origin receives no access-control-allow-origin header",
  );

  // Test 4: Token generation and successful portfolio query
  console.log("\nTest 4: Scoped Token Generation and Portfolio Data Fetch");
  const rawSecret = randomBytes(24).toString("hex");
  const validToken = `gx_tp_live_${rawSecret}`;
  const tokenHash = createHash("sha256").update(validToken).digest("hex");
  const tokenPrefix = `${validToken.slice(0, 19)}...`;

  const tokenRecord = await prisma.appAgencyApiToken.create({
    data: {
      tenantId,
      tokenHash,
      tokenPrefix,
      name: "Automated Test Token",
      createdById: "system-test-runner",
      scopes: ["team_portfolio:read"],
    },
  });

  console.log(`  Generated token with prefix: ${tokenPrefix}`);

  const res4 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    headers: {
      Authorization: `Bearer ${validToken}`,
      Origin: "https://agency.gigxomi.com",
    },
  });
  const data4 = await res4.json();

  assert(res4.status === 200, `Status is 200 OK (got ${res4.status})`);
  assert(data4.success === true, "success is true");
  assert(data4.data.agency.id === tenantId, `Agency ID matches tenant ${tenantId}`);
  assert(Array.isArray(data4.data.teamMembers), "teamMembers is an array");
  assert(typeof data4.data.pagination.total === "number", "pagination.total is a number");

  // Test 5: Strict Zero PII Verification
  console.log("\nTest 5: Zero PII Leakage Verification");
  const jsonString = JSON.stringify(data4);
  const hasPhone = /"phone"\s*:/i.test(jsonString);
  const hasEmail = /"email"\s*:/i.test(jsonString);
  const hasPassword = /"password/i.test(jsonString);
  assert(!hasPhone, "Zero 'phone' fields present in entire response");
  assert(!hasEmail, "Zero 'email' fields present in entire response");
  assert(!hasPassword, "Zero password references in response");

  // Test 6: Cross-Agency Isolation
  console.log("\nTest 6: Cross-Agency Access Isolation (x-agency-id mismatch)");
  const res6 = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    headers: {
      Authorization: `Bearer ${validToken}`,
      "x-agency-id": "other-tenant-unauthorized",
    },
  });
  assert(res6.status === 403, `Status is 403 Forbidden for cross-agency ID header (got ${res6.status})`);

  // Test 7: Orientation Filtering
  console.log("\nTest 7: Orientation Filters");
  const resPortrait = await fetch(`${baseUrl}/api/v1/agency/team-portfolio?orientation=portrait`, {
    headers: { Authorization: `Bearer ${validToken}` },
  });
  const dataPortrait = await resPortrait.json();
  assert(resPortrait.status === 200, "Portrait query status is 200 OK");
  const allPortrait = dataPortrait.data.teamMembers.every((m) =>
    m.portfolioItems.every((item) => item.orientation === "portrait" && item.aspectRatio === "9:16"),
  );
  assert(allPortrait, "All items returned by ?orientation=portrait are strictly portrait (9:16)");

  const resLandscape = await fetch(`${baseUrl}/api/v1/agency/team-portfolio?orientation=landscape`, {
    headers: { Authorization: `Bearer ${validToken}` },
  });
  const dataLandscape = await resLandscape.json();
  assert(resLandscape.status === 200, "Landscape query status is 200 OK");
  const allLandscape = dataLandscape.data.teamMembers.every((m) =>
    m.portfolioItems.every((item) => item.orientation === "landscape" && item.aspectRatio === "16:9"),
  );
  assert(allLandscape, "All items returned by ?orientation=landscape are strictly landscape (16:9)");

  // Test 8: Token Revocation
  console.log("\nTest 8: Token Revocation");
  await prisma.appAgencyApiToken.update({
    where: { id: tokenRecord.id },
    data: { revokedAt: new Date() },
  });

  const resRevoked = await fetch(`${baseUrl}/api/v1/agency/team-portfolio`, {
    headers: { Authorization: `Bearer ${validToken}` },
  });
  const dataRevoked = await resRevoked.json();
  assert(resRevoked.status === 401, `Revoked token returns 401 (got ${resRevoked.status})`);
  assert(dataRevoked.error?.includes("revoked"), `Error message indicates token revocation: "${dataRevoked.error}"`);

  // Test 9: Proxy via 1-gigxomi-app (app.gigxomi.com / Port 3002)
  console.log("\nTest 9: Proxy validation through app.gigxomi.com (Port 3002)");
  const proxySecret = randomBytes(24).toString("hex");
  const proxyToken = `gx_tp_live_${proxySecret}`;
  const proxyHash = createHash("sha256").update(proxyToken).digest("hex");
  const proxyPrefix = `${proxyToken.slice(0, 19)}...`;

  const proxyRecord = await prisma.appAgencyApiToken.create({
    data: {
      tenantId,
      tokenHash: proxyHash,
      tokenPrefix: proxyPrefix,
      name: "Proxy Test Token",
      createdById: "system-test-runner",
      scopes: ["team_portfolio:read"],
    },
  });

  const proxyRes = await fetch(`${proxyUrl}/api/v1/agency/team-portfolio`, {
    headers: { Authorization: `Bearer ${proxyToken}` },
  });
  const proxyData = await proxyRes.json();
  assert(proxyRes.status === 200, `Proxied call through port 3002 returned 200 OK (got ${proxyRes.status})`);
  assert(proxyData.success === true, "Proxied call returned success: true");

  // Clean up proxy test token
  await prisma.appAgencyApiToken.deleteMany({
    where: { id: { in: [tokenRecord.id, proxyRecord.id] } },
  });

  console.log("\n=========================================");
  console.log(`TOTAL TESTS: ${passedCount + failedCount}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);
  console.log("=========================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((err) => {
    console.error("Test execution failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
