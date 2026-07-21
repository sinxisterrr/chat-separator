// Browser-safe port of the conversations.json parsing logic.
// Supports ChatGPT, Claude.ai, and Grok exports.

export interface MappingNode {
  id: string;
  parent: string | null;
  children: string[];
  message: {
    id: string;
    author: { role: string; name?: string | null };
    content: { content_type?: string; parts?: (string | { text?: string } | null)[]; text?: string };
    create_time: number | null;
    weight?: number;
  };
}

export interface ExportRoot {
  mapping: Record<string, MappingNode>;
}

// ─── Grok export shape ─────────────────────────────────────────
interface GrokResponse {
  response: {
    _id: string;
    conversation_id: string;
    message: string;
    sender: "human" | "assistant";
    create_time?: { $date?: { $numberLong?: string } };
    parent_response_id: string | null;
    model?: string;
  };
}

interface GrokConversation {
  conversation: { id: string; title?: string; create_time?: string };
  responses: GrokResponse[];
}

interface GrokExport {
  conversations: GrokConversation[];
}

function isGrokExport(parsed: unknown): parsed is GrokExport {
  const p = parsed as { conversations?: unknown[] };
  return (
    !!p &&
    Array.isArray(p.conversations) &&
    p.conversations.length > 0 &&
    (p.conversations[0] as { responses?: unknown[] })?.responses !== undefined
  );
}

function convertGrokToMapping(grok: GrokExport): Record<string, MappingNode> {
  const mapping: Record<string, MappingNode> = {};

  for (const convo of grok.conversations) {
    // Build children lookup once per conversation instead of an O(n²) filter per response.
    const childrenById: Record<string, string[]> = {};
    for (const resp of convo.responses) {
      const parent = resp.response.parent_response_id;
      if (parent) (childrenById[parent] ??= []).push(resp.response._id);
    }

    for (const resp of convo.responses) {
      const r = resp.response;
      const id = r._id;

      let createTime: number | null = null;
      const ms = r.create_time?.$date?.$numberLong;
      if (ms) createTime = parseInt(ms, 10) / 1000;

      const role = r.sender === "human" ? "user" : "assistant";

      mapping[id] = {
        id,
        parent: r.parent_response_id,
        children: childrenById[id] ?? [],
        message: {
          id,
          author: { role },
          content: { content_type: "text", parts: [r.message || ""] },
          create_time: createTime,
        },
      };
    }
  }

  return mapping;
}

// ─── Claude.ai export shape ────────────────────────────────────
interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeMessage {
  uuid: string;
  text?: string;
  content?: ClaudeContentBlock[];
  sender: "human" | "assistant";
  created_at?: string;
}

interface ClaudeConversation {
  uuid: string;
  name?: string;
  chat_messages: ClaudeMessage[];
}

function isClaudeExport(parsed: unknown): parsed is ClaudeConversation[] {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  const first = parsed[0] as { chat_messages?: unknown; uuid?: unknown };
  return first?.chat_messages !== undefined && first?.uuid !== undefined;
}

function convertClaudeToMapping(conversations: ClaudeConversation[]): Record<string, MappingNode> {
  const mapping: Record<string, MappingNode> = {};

  for (const convo of conversations) {
    let prevId: string | null = null;

    for (const msg of convo.chat_messages) {
      const id = msg.uuid;

      const text =
        msg.content
          ?.filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n")
          .trim() ||
        msg.text ||
        "";

      const role = msg.sender === "human" ? "user" : "assistant";
      const createTime = msg.created_at ? new Date(msg.created_at).getTime() / 1000 : null;

      if (prevId && mapping[prevId]) {
        mapping[prevId].children.push(id);
      }

      mapping[id] = {
        id,
        parent: prevId,
        children: [],
        message: {
          id,
          author: { role },
          content: { content_type: "text", parts: [text] },
          create_time: Number.isFinite(createTime as number) ? createTime : null,
        },
      };

      prevId = id;
    }
  }

  return mapping;
}

export interface ConversationThread {
  id: string;
  messages: MappingNode[];
  weight: number;
}

export interface MessageThread {
  id: string;
  threadTitle: string;
  messageCount: number;
  preview: PreviewLine[];
  messages: MappingNode[];
}

export interface PreviewLine {
  role: string;
  content: string;
  truncated: boolean;
}

export function getText(msg: MappingNode["message"] | null | undefined): string {
  if (!msg || !msg.content) return "";
  const c = msg.content;

  if (Array.isArray(c.parts)) {
    return c.parts
      .filter((p): p is string | { text: string } => {
        if (typeof p === "string") return true;
        if (p && typeof p === "object" && typeof (p as { text?: string }).text === "string") return true;
        return false;
      })
      .map((p) => (typeof p === "string" ? p : (p as { text: string }).text))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof c.text === "string") return c.text.trim();
  return "";
}

export function parseConversationsJSON(text: string): ExportRoot {
  const parsed = JSON.parse(text);

  // Grok export: { conversations: [{ conversation, responses }] }
  if (isGrokExport(parsed)) {
    return { mapping: convertGrokToMapping(parsed) };
  }

  // Claude.ai export: [{ uuid, chat_messages }]
  if (isClaudeExport(parsed)) {
    return { mapping: convertClaudeToMapping(parsed) };
  }

  // ChatGPT array export: [{ mapping }]
  if (Array.isArray(parsed)) {
    const merged: Record<string, MappingNode> = {};
    for (const convo of parsed) {
      if (convo?.mapping) Object.assign(merged, convo.mapping);
    }
    if (Object.keys(merged).length === 0) {
      throw new Error("Recognized an array of conversations but none contained a ChatGPT `mapping` — is this the right export file?");
    }
    return { mapping: merged };
  }

  // Single ChatGPT conversation with mapping at root
  if (parsed?.mapping) return parsed as ExportRoot;

  throw new Error("Unrecognized conversations.json format — expected ChatGPT, Claude.ai, or Grok export.");
}

export function extractThreads(root: ExportRoot): ConversationThread[] {
  const mapping = root.mapping;
  const visited = new Set<string>();
  const threads: ConversationThread[] = [];

  const roots = Object.values(mapping).filter(
    (node) => !node.parent || !mapping[node.parent]
  );

  function walk(id: string, out: MappingNode[] = []): MappingNode[] {
    if (visited.has(id)) return out;
    visited.add(id);
    const n = mapping[id];
    if (!n) return out;
    out.push(n);
    for (const c of n.children || []) walk(c, out);
    return out;
  }

  for (const r of roots) {
    const msgs = walk(r.id);
    const total = msgs.reduce((s, x) => s + (x.message?.weight || 1), 0);
    const avg = msgs.length ? total / msgs.length : 1;
    threads.push({ id: r.id, messages: msgs, weight: avg });
  }

  return threads;
}

export function buildMessageThreads(threads: ConversationThread[]): MessageThread[] {
  return threads.map((thread) => {
    const messages = thread.messages;
    const firstUserMsg = messages.find((m) => m.message?.author?.role === "user");
    const titleText = getText(firstUserMsg?.message);
    const threadTitle =
      titleText.substring(0, 60) + (titleText.length > 60 ? "..." : "") ||
      `Thread ${thread.id.substring(0, 8)}`;

    const previewMessages = messages.slice(0, 8);
    const preview: PreviewLine[] = previewMessages
      .map((m) => {
        const role = m.message?.author?.role || "unknown";
        const content = getText(m.message);
        if (!content) return null;
        return {
          role,
          content: content.substring(0, 120),
          truncated: content.length > 120,
        };
      })
      .filter((x): x is PreviewLine => x !== null);

    return {
      id: thread.id,
      threadTitle,
      messageCount: messages.length,
      preview,
      messages,
    };
  });
}
