import "server-only";

import type {
  SuperAdminWhatsAppFlow,
  SuperAdminWhatsAppFlowEdge,
  SuperAdminWhatsAppFlowNode,
  SuperAdminWhatsAppFlowNodeKind,
} from "@/lib/gigxomi/super-admin-whatsapp-flow-store";

export type WhatsAppFlowValidationSeverity = "error" | "warning" | "info";

export type WhatsAppFlowValidationIssue = {
  severity: WhatsAppFlowValidationSeverity;
  node_id?: string;
  code: string;
  message: string;
  fix_hint: string;
};

const TRIGGER_KINDS = new Set<SuperAdminWhatsAppFlowNodeKind>([
  "trigger-on-message",
  "trigger-keyword",
  "keyword-trigger",
  "trigger-button-reply",
  "trigger-list-reply",
]);

const TERMINAL_KINDS = new Set<SuperAdminWhatsAppFlowNodeKind>(["stop", "handoff"]);

const RUNTIME_BLOCKED_KINDS = new Map<SuperAdminWhatsAppFlowNodeKind, string>([
  ["api-request", "API Request execution is disabled until a reviewed allowlisted integration adapter exists."],
  ["wait", "Wait needs a durable scheduler/resume worker before production publish."],
]);

function issue(input: WhatsAppFlowValidationIssue): WhatsAppFlowValidationIssue {
  return input;
}

function isTrigger(node: SuperAdminWhatsAppFlowNode) {
  return TRIGGER_KINDS.has(node.kind);
}

function buttonPayload(button: { id?: string; value?: string }) {
  return button.id?.trim() || button.value?.trim() || "";
}

function isHttpUrl(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function edgeKey(edge: SuperAdminWhatsAppFlowEdge) {
  return (edge.branchKey || edge.label || "default").trim().toLowerCase();
}

function collectReachable(triggerIds: string[], edgesBySource: Map<string, string[]>) {
  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const target of edgesBySource.get(nodeId) ?? []) {
      visit(target);
    }
  };
  triggerIds.forEach(visit);
  return reachable;
}

function edgeHasBranch(branches: Map<string, Set<string>>, nodeId: string, branch: string) {
  return branches.get(nodeId)?.has(branch.trim().toLowerCase()) ?? false;
}

export function validateWhatsAppFlowForServer(input: {
  flow: Pick<SuperAdminWhatsAppFlow, "id" | "name" | "status" | "triggerMode" | "triggerKeyword" | "nodes" | "edges">;
  channel?: "whatsapp";
}) {
  const flow = input.flow;
  const issues: WhatsAppFlowValidationIssue[] = [];
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const edgesBySource = new Map<string, string[]>();
  const branchesBySource = new Map<string, Set<string>>();

  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(
        issue({
          severity: "error",
          code: "BROKEN_EDGE",
          message: "An edge references a missing source or target node.",
          fix_hint: "Remove the broken edge and reconnect the affected nodes.",
        }),
      );
      continue;
    }

    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    edgesBySource.set(edge.source, [...(edgesBySource.get(edge.source) ?? []), edge.target]);
    branchesBySource.set(edge.source, new Set([...(branchesBySource.get(edge.source) ?? []), edgeKey(edge)]));
  }

  const triggers = flow.nodes.filter(isTrigger);
  if (!triggers.length) {
    issues.push(
      issue({
        severity: "error",
        code: "MISSING_TRIGGER",
        message: "Flow must have at least one trigger node.",
        fix_hint: "Add On Message, On Keyword, On Button Reply, or On List Reply as the first entry point.",
      }),
    );
  }

  for (const trigger of triggers) {
    if (!outgoing.get(trigger.id)) {
      issues.push(
        issue({
          severity: "error",
          node_id: trigger.id,
          code: "TRIGGER_NO_PATH",
          message: `"${trigger.title}" has no outgoing path.`,
          fix_hint: "Connect the trigger to the first message, logic, or action node.",
        }),
      );
    }

    if ((trigger.kind === "trigger-keyword" || trigger.kind === "keyword-trigger") && !(trigger.body?.trim() || flow.triggerKeyword?.trim())) {
      issues.push(
        issue({
          severity: "error",
          node_id: trigger.id,
          code: "MISSING_KEYWORD",
          message: `"${trigger.title}" needs a keyword.`,
          fix_hint: "Enter the exact keyword users should send, such as Get OTP.",
        }),
      );
    }
  }

  const reachable = collectReachable(triggers.map((trigger) => trigger.id), edgesBySource);
  const loopStack = new Set<string>();
  const visited = new Set<string>();
  const loops = new Set<string>();
  const detectLoops = (nodeId: string) => {
    if (loopStack.has(nodeId)) {
      loops.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    loopStack.add(nodeId);
    for (const target of edgesBySource.get(nodeId) ?? []) {
      detectLoops(target);
    }
    loopStack.delete(nodeId);
  };
  triggers.forEach((trigger) => detectLoops(trigger.id));

  for (const node of flow.nodes) {
    const outgoingCount = outgoing.get(node.id) ?? 0;
    const incomingCount = incoming.get(node.id) ?? 0;
    const runtimeBlockedReason = RUNTIME_BLOCKED_KINDS.get(node.kind);

    if (!isTrigger(node) && incomingCount === 0) {
      issues.push(
        issue({
          severity: "warning",
          node_id: node.id,
          code: "DISCONNECTED_NODE",
          message: `"${node.title}" has no incoming connection.`,
          fix_hint: "Connect this node from a trigger or another node, or remove it if it is unused.",
        }),
      );
    }

    if (!reachable.has(node.id)) {
      issues.push(
        issue({
          severity: "warning",
          node_id: node.id,
          code: "UNREACHABLE_NODE",
          message: `"${node.title}" cannot be reached from any trigger.`,
          fix_hint: "Connect the node into a trigger path before relying on it.",
        }),
      );
    }

    if (!TERMINAL_KINDS.has(node.kind) && outgoingCount === 0) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "DEAD_END",
          message: `"${node.title}" ends without a Stop Flow or Human Handoff node.`,
          fix_hint: "Connect the node to the next step, Stop Flow, or Human Handoff.",
        }),
      );
    }

    if (runtimeBlockedReason) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "CAPABILITY_NOT_READY",
          message: `"${node.title}" is not runtime-ready.`,
          fix_hint: runtimeBlockedReason,
        }),
      );
    }

    if ((node.kind === "message-text" || node.kind === "send-message" || node.kind === "message-button" || node.kind === "message-list") && !node.body?.trim()) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "MISSING_MESSAGE",
          message: `"${node.title}" needs message text.`,
          fix_hint: "Add WhatsApp-safe message copy in the Inspector.",
        }),
      );
    }

    if (node.kind === "message-button" || node.kind === "button-message") {
      const buttons = node.buttons ?? [];
      if (buttons.length < 1 || buttons.length > 3) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "INVALID_BUTTON_COUNT",
            message: "WhatsApp reply buttons require 1 to 3 buttons.",
            fix_hint: "Keep this node to a maximum of three reply buttons.",
          }),
        );
      }

      buttons.forEach((button, index) => {
        const payload = buttonPayload(button);
        if (!button.label?.trim()) {
          issues.push(
            issue({
              severity: "error",
              node_id: node.id,
              code: "MISSING_BUTTON_LABEL",
              message: `Button ${index + 1} is missing a label.`,
              fix_hint: "Add a short user-visible button label.",
            }),
          );
        }
        if (button.actionType === "URL") {
          if (!isHttpUrl(button.value)) {
            issues.push(
              issue({
                severity: "error",
                node_id: node.id,
                code: "INVALID_BUTTON_URL",
                message: `URL button "${button.label || index + 1}" needs a valid http(s) link.`,
                fix_hint: "Paste the full URL that should open when the WhatsApp button is tapped.",
              }),
            );
          }
          return;
        }
        if (!payload) {
          issues.push(
            issue({
              severity: "error",
              node_id: node.id,
              code: "MISSING_BUTTON_PAYLOAD",
              message: `Button ${index + 1} is missing a stable payload.`,
              fix_hint: "Add a stable payload/id so replies can route safely.",
            }),
          );
        }
        if (payload && !edgeHasBranch(branchesBySource, node.id, `button:${payload}`)) {
          issues.push(
            issue({
              severity: "error",
              node_id: node.id,
              code: "MISSING_BUTTON_ROUTE",
              message: `Button "${button.label || payload}" does not have a matching route.`,
              fix_hint: `Connect an outgoing edge with branch key button:${payload}.`,
            }),
          );
        }
      });
    }

    if (node.kind === "message-list") {
      const sections = node.listSections ?? [];
      const rowCount = sections.reduce((total, section) => total + (section.rows?.length ?? 0), 0);
      if (!sections.length || rowCount < 1) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "MISSING_LIST_ROWS",
            message: `"${node.title}" needs at least one list row.`,
            fix_hint: "Add at least one section and one row.",
          }),
        );
      }
      if (rowCount > 10) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "LIST_ROW_LIMIT",
            message: "WhatsApp list messages should stay within 10 rows.",
            fix_hint: "Split the list into multiple nodes or reduce the row count.",
          }),
        );
      }
      if (!node.listButtonText?.trim()) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "MISSING_LIST_BUTTON",
            message: `"${node.title}" needs list button text.`,
            fix_hint: "Add the button text shown before users open the list.",
          }),
        );
      }
      sections.forEach((section, sectionIndex) => {
        if (!section.title?.trim()) {
          issues.push(
            issue({
              severity: "error",
              node_id: node.id,
              code: "MISSING_SECTION_TITLE",
              message: `List section ${sectionIndex + 1} needs a title.`,
              fix_hint: "Add a short section title.",
            }),
          );
        }
        section.rows?.forEach((row, rowIndex) => {
          if (!row.id?.trim() || !row.title?.trim()) {
            issues.push(
              issue({
                severity: "error",
                node_id: node.id,
                code: "MISSING_ROW_PAYLOAD",
                message: `List row ${rowIndex + 1} needs an id and title.`,
                fix_hint: "Add a stable row id and user-visible title.",
              }),
            );
          }
          if (row.id?.trim() && !edgeHasBranch(branchesBySource, node.id, `row:${row.id.trim()}`)) {
            issues.push(
              issue({
                severity: "error",
                node_id: node.id,
                code: "MISSING_LIST_ROUTE",
                message: `List row "${row.title || row.id}" does not have a matching route.`,
                fix_hint: `Connect an outgoing edge with branch key row:${row.id.trim()}.`,
              }),
            );
          }
        });
      });
    }

    if (node.kind === "message-template" && !node.templateName?.trim()) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "MISSING_TEMPLATE",
          message: `"${node.title}" is missing an approved template name.`,
          fix_hint: "Use a WhatsApp template that has already been approved in Meta.",
        }),
      );
    }

    if (node.kind === "condition") {
      if (!(node.conditionExpression?.trim() || node.body?.trim())) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "MISSING_CONDITION",
            message: `"${node.title}" needs a condition expression.`,
            fix_hint: "Add a condition such as incomingMessage contains pricing.",
          }),
        );
      }
      if (!edgeHasBranch(branchesBySource, node.id, "true")) {
        issues.push(
          issue({
            severity: "warning",
            node_id: node.id,
            code: "MISSING_TRUE_BRANCH",
            message: `"${node.title}" has no true branch.`,
            fix_hint: "Add a true route if this condition should branch.",
          }),
        );
      }
      if (!edgeHasBranch(branchesBySource, node.id, "false")) {
        issues.push(
          issue({
            severity: "warning",
            node_id: node.id,
            code: "MISSING_FALSE_BRANCH",
            message: `"${node.title}" has no false branch.`,
            fix_hint: "Add a false route or connect a default path intentionally.",
          }),
        );
      }
    }

    if (node.kind === "api-request") {
      if (!node.apiMethod?.trim()) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "MISSING_API_METHOD",
            message: `"${node.title}" is missing an API method.`,
            fix_hint: "Select GET, POST, PUT, PATCH, or DELETE.",
          }),
        );
      }
      if (!node.apiUrl?.trim()) {
        issues.push(
          issue({
            severity: "error",
            node_id: node.id,
            code: "MISSING_API_URL",
            message: `"${node.title}" is missing an API URL.`,
            fix_hint: "Use an allowlisted server-side integration endpoint.",
          }),
        );
      }
    }

    if ((node.kind === "ai-text-generation" || node.kind === "meta-ai") && !(node.aiSystemPrompt?.trim() || node.aiUserPrompt?.trim())) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "MISSING_AI_PROMPT",
          message: `"${node.title}" needs an AI prompt/source.`,
          fix_hint: "Add approved prompt instructions and a safe provider adapter before publish.",
        }),
      );
    }

    if (node.kind === "handoff" && !node.outputVariable?.trim()) {
      issues.push(
        issue({
          severity: "error",
          node_id: node.id,
          code: "MISSING_HANDOFF_QUEUE",
          message: `"${node.title}" needs a queue or manager target.`,
          fix_hint: "Set the queue/manager key used for human assignment.",
        }),
      );
    }
  }

  for (const nodeId of loops) {
    issues.push(
      issue({
        severity: "warning",
        node_id: nodeId,
        code: "POSSIBLE_LOOP",
        message: "This path appears to loop back into itself.",
        fix_hint: "Confirm the loop is intentional and guarded by a wait, condition, or stop path.",
      }),
    );
  }

  return issues;
}
