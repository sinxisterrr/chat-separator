//--------------------------------------------------------------
// FILE: src/core/parse.ts
// Thread Categorizer — Sort conversations into AI files (14 slots)
//--------------------------------------------------------------

import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";

import { loadExport, extractThreads } from "./pipeline.js";
import { printBanner } from "../ui/renderer.js";
import { color, CYAN, GREEN, YELLOW, MAGENTA } from "../ui/colors.js";

const AI_COUNT = 14;
const AI_KEYS = Array.from({ length: AI_COUNT }, (_, i) => `ai${i + 1}`);

type AiKey = `ai${number}`;

interface MessageThread {
  id: string;
  threadTitle: string;
  messageCount: number;
  preview: string;
  messages: any[];
}

/**
 * Extract text from message (handles multiple ChatGPT export formats)
 */
function getText(msg: any): string {
  if (!msg || !msg.content) return "";

  const c: any = msg.content;

  if (Array.isArray(c.parts)) {
    return c.parts
      .filter((part: any) => {
        if (typeof part === "string") return true;
        if (part === null || part === undefined) return false;
        if (typeof part === "object" && part.text) return typeof part.text === "string";
        return false;
      })
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part.text) return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof c.text === "string") return c.text.trim();
  if (typeof c === "string") return c.trim();

  return "";
}

/**
 * Ask user to categorize a thread
 */
async function askCategory(thread: MessageThread, canGoBack: boolean): Promise<string[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(color(`\n${"=".repeat(80)}`, CYAN));
    console.log(color(`Thread: ${thread.threadTitle}`, GREEN));
    console.log(color(`Messages: ${thread.messageCount}`, YELLOW));
    console.log(color(`\nPreview:`, CYAN));
    console.log(thread.preview);
    console.log(color(`${"=".repeat(80)}`, CYAN));

    const menuLines = AI_KEYS.map((k, i) => `[${i + 1}] AI ${i + 1}`).join("\n");
    const backOption = canGoBack ? "[b] Back (undo last)\n" : "";

    rl.question(
      color(
        `\n${menuLines}\n[s] Skip (discard)\n[q] Save & Quit\n${backOption}\nYour choice (comma-separated for multiple, e.g. 1,3): `,
        MAGENTA
      ),
      (answer) => {
        rl.close();
        const choice = answer.trim().toLowerCase();

        if (choice === "b" || choice === "back") {
          if (canGoBack) {
            resolve(["back"]);
          } else {
            console.log(color("Can't go back yet, skipping thread...", YELLOW));
            resolve(["skip"]);
          }
        } else if (choice === "q" || choice === "quit" || choice === "save") {
          resolve(["quit"]);
        } else if (choice === "s" || choice === "skip") {
          resolve(["skip"]);
        } else {
          const choices = choice.split(",").map((c) => c.trim()).filter(Boolean);
          const result: string[] = [];

          for (const c of choices) {
            // Accept "1"-"14" or "ai1"-"ai14"
            const num = c.startsWith("ai") ? parseInt(c.slice(2)) : parseInt(c);
            if (!isNaN(num) && num >= 1 && num <= AI_COUNT) {
              const key = `ai${num}`;
              if (!result.includes(key)) result.push(key);
            }
          }

          if (result.length > 0) {
            resolve(result);
          } else {
            console.log(color("Invalid choice, skipping thread...", YELLOW));
            resolve(["skip"]);
          }
        }
      }
    );
  });
}

/**
 * Save progress to file
 */
function saveProgress(
  currentIndex: number,
  aiThreads: Record<string, MessageThread[]>
): void {
  const progressFile = path.join(process.cwd(), ".categorize-progress.json");
  const progress: Record<string, any> = {
    currentIndex,
    savedAt: Date.now(),
  };
  for (const key of AI_KEYS) {
    progress[key] = aiThreads[key].map((t) => t.id);
  }
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  console.log(color(`\n💾 Progress saved! Resume anytime by running the parser again.`, GREEN));
}

/**
 * Load progress from file
 */
function loadProgress(): Record<string, any> | null {
  const progressFile = path.join(process.cwd(), ".categorize-progress.json");
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

async function main() {
  const inputPath = process.argv[2] || "./input";
  const GOBLIN = process.argv.includes("--goblin") || process.env.GOBLIN_MODE === "1";

  printBanner(GOBLIN);

  console.log(color("\n╔════════════════════════════════════════════╗", CYAN));
  console.log(color("║    Thread Categorizer (14 AIs)            ║", CYAN));
  console.log(color("║    Sort Conversations by AI               ║", CYAN));
  console.log(color("╚════════════════════════════════════════════╝\n", CYAN));

  if (GOBLIN) console.log(color("[goblin-ash] 🧪 goblin mode engaged.\n", MAGENTA));

  try {
    console.log(color(`📂 Loading export from: ${inputPath}`, CYAN));
    const root = await loadExport(inputPath);
    console.log(color(`   Loaded ${Object.keys(root.mapping).length} nodes`, GREEN));

    console.log(color("\n🔍 Extracting threads...", CYAN));
    const extractedThreads = extractThreads(root);
    console.log(color(`\n✨ Found ${extractedThreads.length} threads`, GREEN));

    // Build MessageThread list
    const allThreads: MessageThread[] = extractedThreads.map((thread) => {
      const messages = thread.messages;
      const firstUserMsg = messages.find((m: any) => m.message?.author?.role === "user");
      const titleText = getText(firstUserMsg?.message);
      const threadTitle = titleText.substring(0, 50) + (titleText.length > 50 ? "..." : "");

      const previewMessages = messages.slice(0, 10);
      const preview = previewMessages
        .map((m: any) => {
          const role = m.message?.author?.role || "unknown";
          const content = getText(m.message);
          if (!content) return null;
          return `${role}: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`;
        })
        .filter(Boolean)
        .join("\n");

      return {
        id: thread.id,
        threadTitle: threadTitle || `Thread ${thread.id.substring(0, 8)}`,
        messageCount: messages.length,
        preview: preview + (messages.length > 10 ? `\n... (${messages.length - 10} more messages)` : ""),
        messages,
      };
    });

    console.log(color(`\n📋 Prepared ${allThreads.length} threads for categorization`, GREEN));

    // Init 14 category arrays
    const aiThreads: Record<string, MessageThread[]> = {};
    for (const key of AI_KEYS) aiThreads[key] = [];

    // Restore saved progress
    const savedProgress = loadProgress();
    let startIndex = 0;

    if (savedProgress) {
      console.log(color(`\n📂 Found saved progress from ${new Date(savedProgress.savedAt).toLocaleString()}`, YELLOW));
      console.log(color(`   Already categorized: ${savedProgress.currentIndex} threads`, CYAN));

      for (const thread of allThreads) {
        for (const key of AI_KEYS) {
          if (savedProgress[key]?.includes(thread.id)) {
            aiThreads[key].push(thread);
          }
        }
      }

      startIndex = savedProgress.currentIndex;
      console.log(color(`\n✅ Resuming from thread ${startIndex + 1}...\n`, GREEN));
    }

    // History for undo
    const history: Array<{ thread: MessageThread; categories: string[] }> = [];

    let i = startIndex;
    while (i < allThreads.length) {
      const thread = allThreads[i];
      console.log(color(`\n[${i + 1}/${allThreads.length}]`, MAGENTA));

      const categories = await askCategory(thread, history.length > 0);

      if (categories.includes("quit")) {
        saveProgress(i, aiThreads);
        console.log(color("\n👋 Goodbye!\n", CYAN));
        process.exit(0);
      } else if (categories.includes("back")) {
        const lastDecision = history.pop();
        if (lastDecision) {
          console.log(color(`↩️  Undoing: ${lastDecision.thread.threadTitle.substring(0, 30)}...`, YELLOW));
          for (const cat of lastDecision.categories) {
            const arr = aiThreads[cat];
            if (arr) {
              const idx = arr.findIndex((t) => t.id === lastDecision.thread.id);
              if (idx !== -1) arr.splice(idx, 1);
            }
          }
          i--;
          continue;
        }
      } else if (categories.includes("skip")) {
        history.push({ thread, categories: ["skip"] });
        if (history.length > 5) history.shift();
        console.log(color("⊘ Skipped - discarded", YELLOW));
        i++;
      } else {
        const labels: string[] = [];
        for (const cat of categories) {
          if (aiThreads[cat]) {
            aiThreads[cat].push(thread);
            const num = cat.slice(2);
            labels.push(`AI ${num}`);
          }
        }
        if (labels.length > 0) {
          history.push({ thread, categories });
          if (history.length > 5) history.shift();
          console.log(color(`✓ Marked as: ${labels.join(", ")}`, GREEN));
        }
        i++;
      }
    }

    // Write output files
    const outDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    let totalWritten = 0;
    for (const key of AI_KEYS) {
      const threads = aiThreads[key];
      if (threads.length > 0) {
        const mapping: Record<string, any> = {};
        for (const thread of threads) {
          for (const msg of thread.messages) {
            mapping[msg.id] = msg;
          }
        }
        const num = key.slice(2);
        fs.writeFileSync(
          path.join(outDir, `${key}.json`),
          JSON.stringify({ mapping }, null, 2)
        );
        console.log(color(`✅ Wrote ${threads.length} threads → output/ai${num}.json`, GREEN));
        totalWritten += threads.length;
      }
    }

    // Clean up progress file
    const progressFile = path.join(process.cwd(), ".categorize-progress.json");
    if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);

    // Summary
    console.log(color("\n" + "=".repeat(80), CYAN));
    console.log(color("📊 Summary:", MAGENTA));
    for (const key of AI_KEYS) {
      const num = key.slice(2);
      if (aiThreads[key].length > 0) {
        console.log(color(`   AI ${num.padStart(2)}: ${aiThreads[key].length} threads`, YELLOW));
      }
    }
    console.log(color(`   Skipped: ${allThreads.length - totalWritten} threads`, YELLOW));
    console.log(color("=".repeat(80) + "\n", CYAN));

    console.log(color("\n✨ Done! Output written to ./output/\n", CYAN));

  } catch (err) {
    console.error(color("\n❌ Parser failed:", YELLOW));
    if (GOBLIN) console.error(color("[goblin-ash] 💥 chaos detected.", MAGENTA));
    console.error(err);
    process.exit(1);
  }
}

main();
