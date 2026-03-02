// Browser-safe port of the conversations.json parsing logic

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

  if (Array.isArray(parsed)) {
    const merged: Record<string, MappingNode> = {};
    for (const convo of parsed) {
      if (convo?.mapping) Object.assign(merged, convo.mapping);
    }
    return { mapping: merged };
  }

  if (parsed?.mapping) return parsed as ExportRoot;

  throw new Error("Unrecognized conversations.json format — expected a mapping object or array of conversations.");
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
