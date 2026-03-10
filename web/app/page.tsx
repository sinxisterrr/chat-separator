"use client";

import { useRef, useState, useCallback } from "react";
import {
  parseConversationsJSON,
  extractThreads,
  buildMessageThreads,
  type MessageThread,
} from "@/lib/parser";
import {
  AI_COUNT,
  AI_KEYS,
  buildInitialAssignments,
  downloadZip,
  type AiAssignments,
} from "@/lib/download";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Stage = "upload" | "categorizing" | "done";

interface HistoryEntry {
  thread: MessageThread;
  categories: string[];
  wasSkip: boolean;
}

// ─────────────────────────────────────────────────────────────
// Upload zone
// ─────────────────────────────────────────────────────────────

function UploadZone({
  onFile,
  parseError,
}: {
  onFile: (file: File) => void;
  parseError: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handle(file: File) {
    setLocalError(null);
    if (!file.name.endsWith(".json")) {
      setLocalError("Please upload a .json file (your ChatGPT conversations export).");
      return;
    }
    onFile(file);
  }

  const error = parseError ?? localError;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <h1 className="text-3xl font-bold mb-2 tracking-tight">Chat Separator</h1>
      <p className="text-zinc-400 mb-10 text-sm text-center max-w-sm">
        Upload your ChatGPT{" "}
        <code className="text-zinc-300 bg-zinc-800 px-1 rounded">conversations.json</code> export
        and sort each thread into one of 14 AI slots. Download as a zip when done.
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handle(file);
        }}
        className={`
          w-full max-w-md border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-colors select-none
          ${
            dragging
              ? "border-violet-400 bg-violet-950/30"
              : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/50"
          }
        `}
      >
        <div className="text-5xl mb-4">📂</div>
        <p className="text-zinc-300 font-medium">Drop your conversations.json here</p>
        <p className="text-zinc-500 text-sm mt-1">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
          }}
        />
      </div>

      {error && (
        <p className="mt-4 text-red-400 text-sm max-w-md text-center">{error}</p>
      )}

      <p className="mt-8 text-zinc-600 text-xs">
        Everything runs in your browser — your file never leaves your device.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Role badge
// ─────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    user: "bg-blue-900/60 text-blue-300",
    assistant: "bg-emerald-900/60 text-emerald-300",
    system: "bg-zinc-800 text-zinc-400",
    tool: "bg-amber-900/60 text-amber-300",
  };
  const cls = colors[role] ?? "bg-zinc-800 text-zinc-400";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono mr-2 flex-shrink-0 ${cls}`}
    >
      {role}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Categorize screen
// ─────────────────────────────────────────────────────────────

function CategorizeScreen({
  threads,
  onDone,
}: {
  threads: MessageThread[];
  onDone: (assignments: AiAssignments, skipped: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [assignments, setAssignments] = useState<AiAssignments>(buildInitialAssignments);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [multiMode, setMultiMode] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  const thread = threads[index];
  const progress = Math.round((index / threads.length) * 100);

  const assign = useCallback(
    (keys: string[]) => {
      setAssignments((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = [...(prev[k] ?? []), thread];
        return next;
      });
      setHistory((h) => [...h.slice(-9), { thread, categories: keys, wasSkip: false }]);
      setPendingKeys(new Set());
      setIndex((i) => i + 1);
    },
    [thread]
  );

  const skip = useCallback(() => {
    setHistory((h) => [...h.slice(-9), { thread, categories: [], wasSkip: true }]);
    setPendingKeys(new Set());
    setSkipped((s) => s + 1);
    setIndex((i) => i + 1);
  }, [thread]);

  const back = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    if (last.wasSkip) {
      setSkipped((s) => Math.max(0, s - 1));
    } else {
      setAssignments((prev) => {
        const next = { ...prev };
        for (const k of last.categories) {
          next[k] = (prev[k] ?? []).filter((t) => t.id !== last.thread.id);
        }
        return next;
      });
    }
    setIndex((i) => Math.max(0, i - 1));
  }, [history]);

  // Auto-finish when all threads are done
  if (index >= threads.length) {
    return (
      <DoneScreen assignments={assignments} total={threads.length} skipped={skipped} />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header / progress */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <span className="text-zinc-400 text-sm font-mono whitespace-nowrap">
          {index + 1} / {threads.length}
        </span>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-zinc-500 text-xs">{progress}%</span>
      </div>

      {/* Thread preview */}
      <div className="flex-1 overflow-y-auto px-6 py-5 max-w-3xl w-full mx-auto">
        <div className="mb-1 flex items-baseline gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-zinc-100 leading-snug">
            {thread.threadTitle}
          </h2>
          <span className="text-xs text-zinc-500 flex-shrink-0">
            {thread.messageCount} messages
          </span>
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          {thread.preview.length === 0 && (
            <p className="text-zinc-500 text-sm italic">No readable preview.</p>
          )}
          {thread.preview.map((line, i) => (
            <div key={i} className="flex items-start text-sm">
              <RoleBadge role={line.role} />
              <span className="text-zinc-300 leading-relaxed">
                {line.content}
                {line.truncated && <span className="text-zinc-600">…</span>}
              </span>
            </div>
          ))}
          {thread.messageCount > 8 && (
            <p className="text-zinc-600 text-xs pt-1">
              +{thread.messageCount - 8} more messages not shown
            </p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="border-t border-zinc-800 px-6 py-5 bg-zinc-900/80 backdrop-blur sticky bottom-0">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* AI slot grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: AI_COUNT }, (_, i) => {
              const key = `ai${i + 1}`;
              const count = assignments[key]?.length ?? 0;
              const selected = pendingKeys.has(key);
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (!multiMode) {
                      assign([key]);
                    } else {
                      setPendingKeys((prev) => {
                        const next = new Set(prev);
                        next.has(key) ? next.delete(key) : next.add(key);
                        return next;
                      });
                    }
                  }}
                  className={`relative py-2.5 rounded-lg active:scale-95 transition-all text-sm font-semibold
                    ${selected
                      ? "bg-violet-600 text-white ring-2 ring-violet-400"
                      : "bg-zinc-800 hover:bg-violet-700 text-zinc-200 hover:text-white"
                    }`}
                >
                  {i + 1}
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-violet-500 text-white rounded-full w-4 h-4 flex items-center justify-center leading-none font-bold">
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Secondary row */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMultiMode((m) => {
                  if (m) setPendingKeys(new Set()); // clear on exit
                  return !m;
                });
              }}
              className={`px-3 py-2 rounded-lg text-sm transition-colors font-medium
                ${multiMode
                  ? "bg-violet-700 text-white"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
            >
              Multi
            </button>
            {multiMode && pendingKeys.size > 0 && (
              <button
                onClick={() => assign([...pendingKeys])}
                className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
              >
                Assign to {pendingKeys.size} slot{pendingKeys.size > 1 ? "s" : ""} →
              </button>
            )}
            {(!multiMode || pendingKeys.size === 0) && (
              <button
                onClick={skip}
                className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={back}
              disabled={history.length === 0}
              className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              onClick={() => onDone(assignments, skipped)}
              className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-emerald-800 text-zinc-400 hover:text-emerald-200 text-sm transition-colors"
            >
              Done ↓
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Done screen
// ─────────────────────────────────────────────────────────────

function DoneScreen({
  assignments,
  total,
  skipped,
}: {
  assignments: AiAssignments;
  total: number;
  skipped: number;
}) {
  const [downloading, setDownloading] = useState(false);

  const summary = AI_KEYS.map((k) => ({
    key: k,
    num: parseInt(k.slice(2)),
    count: assignments[k]?.length ?? 0,
  })).filter((x) => x.count > 0);

  const assigned = summary.reduce((s, x) => s + x.count, 0);
  const maxCount = Math.max(1, ...summary.map((x) => x.count));

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadZip(assignments);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-2xl font-bold mb-1">All done!</h2>
      <p className="text-zinc-400 text-sm mb-8">
        {assigned} assigned · {skipped} skipped · {total} total
      </p>

      {summary.length > 0 && (
        <div className="w-full max-w-xs mb-8 space-y-2">
          {summary.map(({ num, count }) => (
            <div key={num} className="flex items-center gap-3 text-sm">
              <span className="text-zinc-500 w-10 text-right flex-shrink-0">AI {num}</span>
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-600 rounded-full"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-zinc-300 font-mono text-xs w-4 text-right flex-shrink-0">
                {count}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={downloading || summary.length === 0}
        className="px-8 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-base"
      >
        {downloading ? "Building zip…" : "Download zip"}
      </button>

      {summary.length === 0 && (
        <p className="mt-3 text-zinc-500 text-xs">
          No threads were assigned — nothing to download.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage] = useState<Stage>("upload");
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [finalAssignments, setFinalAssignments] = useState<AiAssignments | null>(null);
  const [finalSkipped, setFinalSkipped] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleFile(file: File) {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const root = parseConversationsJSON(text);
        const rawThreads = extractThreads(root);
        const built = buildMessageThreads(rawThreads);
        setThreads(built);
        setStage("categorizing");
      } catch (err) {
        setParseError(
          err instanceof Error ? err.message : "Failed to parse file — is it a valid conversations.json?"
        );
      }
    };
    reader.readAsText(file);
  }

  function handleDone(assignments: AiAssignments, skipped: number) {
    setFinalAssignments(assignments);
    setFinalSkipped(skipped);
    setStage("done");
  }

  if (stage === "upload") {
    return <UploadZone onFile={handleFile} parseError={parseError} />;
  }

  if (stage === "categorizing") {
    return <CategorizeScreen threads={threads} onDone={handleDone} />;
  }

  if (stage === "done" && finalAssignments) {
    return (
      <DoneScreen
        assignments={finalAssignments}
        total={threads.length}
        skipped={finalSkipped}
      />
    );
  }

  return null;
}
