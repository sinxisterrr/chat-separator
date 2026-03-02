import JSZip from "jszip";
import type { MessageThread } from "./parser";

export const AI_COUNT = 14;
export const AI_KEYS = Array.from({ length: AI_COUNT }, (_, i) => `ai${i + 1}`);

export type AiAssignments = Record<string, MessageThread[]>;

export function buildInitialAssignments(): AiAssignments {
  const out: AiAssignments = {};
  for (const key of AI_KEYS) out[key] = [];
  return out;
}

export async function downloadZip(assignments: AiAssignments): Promise<void> {
  const zip = new JSZip();

  let totalFiles = 0;
  for (const key of AI_KEYS) {
    const threads = assignments[key];
    if (threads.length === 0) continue;

    const mapping: Record<string, unknown> = {};
    for (const thread of threads) {
      for (const msg of thread.messages) {
        mapping[msg.id] = msg;
      }
    }

    zip.file(`${key}.json`, JSON.stringify({ mapping }, null, 2));
    totalFiles++;
  }

  if (totalFiles === 0) {
    alert("No threads have been assigned yet!");
    return;
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "categorized-conversations.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
