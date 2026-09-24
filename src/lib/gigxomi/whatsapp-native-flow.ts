export type WhatsAppNativeFlowMessageInput = {
  to: string;
  flowId: string;
  flowToken: string;
  body: string;
  cta: string;
  screen?: string;
  header?: string;
  footer?: string;
};

const PROJECT_BRIEF_LABELS: Record<string, string> = {
  project_name: "Project name",
  projectName: "Project name",
  google_drive_link: "Google Drive link",
  googleDriveLink: "Google Drive link",
  reference_video_link: "Reference video link",
  referenceVideoLink: "Reference video link",
  editing_notes: "Editing notes",
  editing_note: "Editing notes",
  editingNotes: "Editing notes",
};

function readableKey(key: string) {
  return PROJECT_BRIEF_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "").trim();
}

export function parseWhatsAppFlowResponse(responseJson: unknown): Record<string, unknown> | null {
  if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
    return responseJson as Record<string, unknown>;
  }
  if (typeof responseJson !== "string" || !responseJson.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(responseJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function formatWhatsAppFlowResponse(responseJson: unknown) {
  const response = parseWhatsAppFlowResponse(responseJson);
  if (!response) return "";

  const entries = Object.entries(response)
    .filter(([key]) => key !== "flow_token")
    .map(([key, value]) => [readableKey(key), displayValue(value)] as const)
    .filter(([, value]) => Boolean(value));

  if (!entries.length) {
    return "Project brief submitted through WhatsApp form.";
  }

  return ["Project brief submitted", ...entries.map(([label, value]) => `${label}: ${value}`)].join("\n");
}

export function buildWhatsAppNativeFlowPayload(input: WhatsAppNativeFlowMessageInput) {
  const parameters: Record<string, unknown> = {
    flow_message_version: "3",
    flow_action: "navigate",
    flow_token: input.flowToken,
    flow_id: input.flowId,
    flow_cta: input.cta,
  };

  if (input.screen?.trim()) {
    parameters.flow_action_payload = {
      screen: input.screen.trim(),
      data: {},
    };
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "flow",
      ...(input.header?.trim()
        ? {
            header: {
              type: "text",
              text: input.header.trim(),
            },
          }
        : {}),
      body: {
        text: input.body.trim(),
      },
      ...(input.footer?.trim()
        ? {
            footer: {
              text: input.footer.trim(),
            },
          }
        : {}),
      action: {
        name: "flow",
        parameters,
      },
    },
  };
}
