import "server-only";

import projectBriefFlowJson from "../../../docs/whatsapp/gigxomi-project-brief-flow.json";

import { getWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

const PROJECT_BRIEF_FLOW_NAME = "gigxomi_project_brief";

type MetaGraphErrorPayload = {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    type?: string;
  };
};

type MetaFlowRecord = {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "DEPRECATED" | string;
  validation_errors?: Array<{ message?: string }>;
};

function graphVersion(value: string) {
  const normalized = value.trim();
  return /^v\d+\.\d+$/.test(normalized) ? normalized : "v25.0";
}

async function readMetaPayload<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T & MetaGraphErrorPayload;
}

function metaError(payload: MetaGraphErrorPayload, fallback: string) {
  const message = payload.error?.message?.trim() || fallback;
  const code = payload.error?.code ? ` (Meta ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""})` : "";
  return `${message}${code}`;
}

async function graphRequest(input: {
  accessToken: string;
  graphApiVersion: string;
  path: string;
  method?: "GET" | "POST";
  body?: BodyInit;
}) {
  return fetch(`https://graph.facebook.com/${graphVersion(input.graphApiVersion)}/${input.path.replace(/^\/+/, "")}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: input.body,
    cache: "no-store",
  });
}

async function listProjectBriefFlows(input: { accessToken: string; graphApiVersion: string; wabaId: string }) {
  const query = new URLSearchParams({
    fields: "id,name,status,validation_errors",
    limit: "100",
  });
  const response = await graphRequest({
    ...input,
    path: `${input.wabaId}/flows?${query.toString()}`,
  });
  const payload = await readMetaPayload<{ data?: MetaFlowRecord[] }>(response);
  if (!response.ok) throw new Error(metaError(payload, "Meta could not list WhatsApp Flows for this business account."));
  return (payload.data ?? []).filter((flow) => flow.name === PROJECT_BRIEF_FLOW_NAME);
}

async function createProjectBriefFlow(input: { accessToken: string; graphApiVersion: string; wabaId: string }) {
  const form = new FormData();
  form.set("name", PROJECT_BRIEF_FLOW_NAME);
  form.set("categories", JSON.stringify(["LEAD_GENERATION"]));
  const response = await graphRequest({
    ...input,
    path: `${input.wabaId}/flows`,
    method: "POST",
    body: form,
  });
  const payload = await readMetaPayload<{ id?: string }>(response);
  if (!response.ok || !payload.id) throw new Error(metaError(payload, "Meta could not create the Gigxomi project-brief Flow."));
  return payload.id;
}

async function uploadProjectBriefJson(input: { accessToken: string; graphApiVersion: string; flowId: string }) {
  const form = new FormData();
  form.set("file", new Blob([JSON.stringify(projectBriefFlowJson)], { type: "application/json" }), "flow.json");
  form.set("name", "flow.json");
  form.set("asset_type", "FLOW_JSON");
  const response = await graphRequest({
    ...input,
    path: `${input.flowId}/assets`,
    method: "POST",
    body: form,
  });
  const payload = await readMetaPayload<{ success?: boolean; validation_errors?: Array<{ message?: string }> }>(response);
  if (!response.ok || !payload.success) throw new Error(metaError(payload, "Meta could not upload the project-brief Flow JSON."));
  const validationErrors = payload.validation_errors ?? [];
  if (validationErrors.length) {
    throw new Error(`Meta rejected the Flow JSON: ${validationErrors.map((error) => error.message || "Unknown validation error").join(" | ")}`);
  }
}

async function publishProjectBriefFlow(input: { accessToken: string; graphApiVersion: string; flowId: string }) {
  const response = await graphRequest({
    ...input,
    path: `${input.flowId}/publish`,
    method: "POST",
  });
  const payload = await readMetaPayload<{ success?: boolean }>(response);
  if (!response.ok || !payload.success) throw new Error(metaError(payload, "Meta could not publish the project-brief Flow."));
}

export async function provisionGigxomiProjectBriefFlow(tenantId = "tenant-gigxomi") {
  const connection = await getWhatsAppConnectionStateFromFile(tenantId);
  if (!connection) throw new Error("Connect the official Gigxomi WhatsApp account before creating the form.");
  const accessToken = connection.accessToken.trim();
  const wabaId = connection.wabaId.trim();
  if (!accessToken || !wabaId) {
    throw new Error("WhatsApp setup is missing the access token or WABA ID. Finish Embedded Signup before publishing the form.");
  }

  const requestBase = { accessToken, graphApiVersion: connection.graphApiVersion, wabaId };
  const existing = await listProjectBriefFlows(requestBase);
  const published = existing.find((flow) => flow.status === "PUBLISHED");
  if (published) {
    return { flowId: published.id, status: "PUBLISHED" as const, created: false };
  }

  const draft = existing.find((flow) => flow.status === "DRAFT");
  const flowId = draft?.id ?? (await createProjectBriefFlow(requestBase));
  await uploadProjectBriefJson({ accessToken, graphApiVersion: connection.graphApiVersion, flowId });
  await publishProjectBriefFlow({ accessToken, graphApiVersion: connection.graphApiVersion, flowId });
  return { flowId, status: "PUBLISHED" as const, created: !draft };
}
