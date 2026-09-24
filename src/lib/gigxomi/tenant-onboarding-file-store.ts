import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { agencyTenants, type AgencyTenant } from "@/lib/gigxomi/agency-network-data";

type TenantOnboardingStore = {
  tenants: AgencyTenant[];
  updatedAt: string;
};

type TenantOnboardingUpdates = Partial<Pick<AgencyTenant, "name" | "whatsappNumber" | "whatsappDisplayName" | "publicPageTitle" | "publicPageDescription">>;

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "tenant-onboarding-store.json");

let queue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function readStore() {
  try {
    const contents = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(contents) as Partial<TenantOnboardingStore>;
    return {
      tenants: Array.isArray(parsed.tenants) && parsed.tenants.length ? parsed.tenants : [...agencyTenants],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    } satisfies TenantOnboardingStore;
  } catch {
    const seeded: TenantOnboardingStore = {
      tenants: [...agencyTenants],
      updatedAt: nowIso(),
    };
    await mkdir(STORE_DIRECTORY, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(seeded, null, 2), "utf8");
    return seeded;
  }
}

async function writeStore(store: TenantOnboardingStore) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function withStore<T>(action: (store: TenantOnboardingStore) => Promise<T> | T, options?: { persist?: boolean }) {
  const run = async () => {
    const store = await readStore();
    const result = await action(store);

    if (options?.persist !== false) {
      store.updatedAt = nowIso();
      await writeStore(store);
    }

    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function getTenantByIdFromFile(tenantId: string) {
  return withStore((store) => store.tenants.find((tenant) => tenant.id === tenantId) ?? null, { persist: false });
}

export function submitWhatsAppOnboardingFromFile(tenantId: string, updates: TenantOnboardingUpdates) {
  return withStore((store) => {
    const tenant = store.tenants.find((entry) => entry.id === tenantId);
    if (!tenant) {
      return null;
    }

    const nextName = typeof updates.name === "string" && updates.name.trim() ? updates.name.trim() : tenant.name;
    const nextSlug = slugify(nextName) || tenant.slug;

    Object.assign(tenant, {
      name: nextName,
      slug: nextSlug,
      whatsappNumber: typeof updates.whatsappNumber === "string" ? updates.whatsappNumber : tenant.whatsappNumber,
      whatsappDisplayName: typeof updates.whatsappDisplayName === "string" ? updates.whatsappDisplayName : tenant.whatsappDisplayName,
      publicPageTitle: typeof updates.publicPageTitle === "string" ? updates.publicPageTitle : tenant.publicPageTitle,
      publicPageDescription: typeof updates.publicPageDescription === "string" ? updates.publicPageDescription : tenant.publicPageDescription,
      showcaseUrl: `/agency/${nextSlug}`,
      status: tenant.status === "Active" ? "Active" : "Pending approval",
      note:
        tenant.status === "Active"
          ? "Tenant details updated and ready for operational review."
          : "WhatsApp onboarding submitted and waiting for super-admin review.",
    });

    return tenant;
  });
}
