"use client";

/**
 * Document workspace canvas.
 *
 * Zero-dependency rich text: a native HTML5 contentEditable surface driven by
 * document.execCommand formatting. No editor frameworks (Tiptap/Slate/Lexical/
 * ProseMirror) — the browser is the rendering engine.
 *
 * Clearance rules enforced in this component (and re-enforced in storage.ts):
 *   owner  → full read/write + share administration
 *   editor → full read/write
 *   viewer → read-only canvas, toolbar hidden, amber "Read-Only Mode" banner
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bold,
  Eraser,
  FileUp,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Lock,
  Redo2,
  ShieldAlert,
  Underline,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import {
  DocumentItem,
  PermissionRole,
  User,
  canEdit,
  canShare,
  isReadOnly,
} from "@/types";
import {
  getDocument,
  getUserById,
  getUsers,
  revokeAccess,
  shareDocument,
  subscribe,
  updateDocument,
} from "@/utils/storage";

/* ------------------------------------------------------------------ */
/* File ingestion: .txt / .md → editor HTML                            */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Convert plain text / light Markdown into clean editor HTML.
 * Supports # / ## / ### headings, "- "/"* " bullets, "1." numbered
 * lists, **bold**, *italic*, `code`; everything else becomes paragraphs.
 */
export function importTextToHtml(raw: string): string {
  const lines = escapeHtml(raw).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);

    if (!trimmed) {
      closeList();
      continue;
    }
    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
      continue;
    }
    closeList();
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else {
      out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function AvatarChip({ user, size = "md" }: { user: User; size?: "sm" | "md" }) {
  const px = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span
      className={`inline-flex ${px} shrink-0 items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: user.avatarColor }}
      aria-hidden
    >
      {user.name
        .split(" ")
        .map((n) => n[0])
        .join("")}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Editor component                                                    */
/* ------------------------------------------------------------------ */

interface DocumentEditorProps {
  documentId: string;
  activeUser: User;
  onBack: () => void;
}

type SaveState = "idle" | "saving" | "saved";

export default function DocumentEditor({
  documentId,
  activeUser,
  onBack,
}: DocumentEditorProps) {
  const [doc, setDoc] = useState<DocumentItem | undefined>(() =>
    getDocument(documentId)
  );
  const [titleDraft, setTitleDraft] = useState(doc?.title ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<string>("");
  const [shareRole, setShareRole] = useState<PermissionRole>("viewer");

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editable = doc ? canEdit(doc, activeUser.id) : false;
  const readOnly = doc ? isReadOnly(doc, activeUser.id) : false;
  const shareable = doc ? canShare(doc, activeUser.id) : false;

  /* Keep the local doc snapshot in sync with the store. */
  useEffect(() => {
    const refresh = () => setDoc(getDocument(documentId));
    const unsubscribe = subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [documentId]);

  /* Hydrate the canvas once per document (never on store echoes, to protect the caret). */
  useEffect(() => {
    const current = getDocument(documentId);
    if (canvasRef.current && current) {
      canvasRef.current.innerHTML = current.content;
      setTitleDraft(current.title);
    }
  }, [documentId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persistContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    try {
      setSaveState("saving");
      const updated = updateDocument(doc.id, activeUser.id, {
        content: canvas.innerHTML,
      });
      setDoc(updated);
      setSaveState("saved");
      setLastSavedAt(updated.updatedAt);
    } catch {
      setSaveState("idle");
    }
  }, [doc, activeUser.id]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistContent, 400);
  }, [persistContent]);

  /** Toolbar command. mousedown is prevented by the buttons so the selection survives. */
  const exec = useCallback(
    (command: string, value?: string) => {
      if (!editable) return;
      canvasRef.current?.focus();
      document.execCommand(command, false, value);
      scheduleSave();
    },
    [editable, scheduleSave]
  );

  const handleTitleCommit = useCallback(() => {
    if (!doc || !editable) return;
    const next = titleDraft.trim() || "Untitled document";
    setTitleDraft(next);
    if (next !== doc.title) {
      try {
        updateDocument(doc.id, activeUser.id, { title: next });
      } catch {
        /* storage layer guards permissions; UI stays silent */
      }
    }
  }, [doc, editable, titleDraft, activeUser.id]);

  /* ---------------------------- file upload ---------------------------- */

  const ACCEPTED_EXTENSIONS = [".txt", ".md"];

  const handleFilePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      const lower = file.name.toLowerCase();
      const isSupported = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!isSupported) {
        setUploadError(
          `Unsupported file type. Please upload a ${ACCEPTED_EXTENSIONS.join(" or ")} file.`
        );
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => setUploadError("Could not read that file. Please try again.");
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.innerHTML += importTextToHtml(text);
        persistContent();
      };
      reader.readAsText(file);
    },
    [persistContent]
  );

  /* ----------------------------- sharing ------------------------------- */

  const candidateUsers = useMemo(() => {
    if (!doc) return [] as User[];
    const sharedIds = new Set(doc.sharedWith.map((p) => p.userId));
    return getUsers().filter((u) => u.id !== doc.ownerId && !sharedIds.has(u.id));
  }, [doc]);

  useEffect(() => {
    setShareTarget((current) =>
      candidateUsers.some((u) => u.id === current)
        ? current
        : candidateUsers[0]?.id ?? ""
    );
  }, [candidateUsers]);

  const handleShare = useCallback(() => {
    if (!doc || !shareTarget) return;
    setShareError(null);
    try {
      shareDocument(doc.id, activeUser.id, shareTarget, shareRole);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Could not share.");
    }
  }, [doc, shareTarget, shareRole, activeUser.id]);

  const handleRoleChange = useCallback(
    (targetUserId: string, role: PermissionRole) => {
      if (!doc) return;
      setShareError(null);
      try {
        shareDocument(doc.id, activeUser.id, targetUserId, role);
      } catch (error) {
        setShareError(error instanceof Error ? error.message : "Could not update role.");
      }
    },
    [doc, activeUser.id]
  );

  const handleRevoke = useCallback(
    (targetUserId: string) => {
      if (!doc) return;
      setShareError(null);
      try {
        revokeAccess(doc.id, activeUser.id, targetUserId);
      } catch (error) {
        setShareError(error instanceof Error ? error.message : "Could not revoke access.");
      }
    },
    [doc, activeUser.id]
  );

  /* ----------------------------- render -------------------------------- */

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-slate-500">This document is unavailable or was deleted.</p>
        <button
          onClick={onBack}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" /> Back to documents
        </button>
      </div>
    );
  }

  const owner = getUserById(doc.ownerId);
  const wordCount = doc.content
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  const toolbarButtons: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }> = [
    { label: "Bold", icon: <Bold className="h-4 w-4" />, onClick: () => exec("bold") },
    { label: "Italic", icon: <Italic className="h-4 w-4" />, onClick: () => exec("italic") },
    { label: "Underline", icon: <Underline className="h-4 w-4" />, onClick: () => exec("underline") },
    { label: "Heading 1", icon: <Heading1 className="h-4 w-4" />, onClick: () => exec("formatBlock", "h1") },
    { label: "Heading 2", icon: <Heading2 className="h-4 w-4" />, onClick: () => exec("formatBlock", "h2") },
    { label: "Normal text", icon: <Eraser className="h-4 w-4" />, onClick: () => exec("formatBlock", "p") },
    { label: "Bulleted list", icon: <List className="h-4 w-4" />, onClick: () => exec("insertUnorderedList") },
    { label: "Numbered list", icon: <ListOrdered className="h-4 w-4" />, onClick: () => exec("insertOrderedList") },
    { label: "Undo", icon: <Undo2 className="h-4 w-4" />, onClick: () => exec("undo") },
    { label: "Redo", icon: <Redo2 className="h-4 w-4" />, onClick: () => exec("redo") },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      {/* Context bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" /> Documents
        </button>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {owner && owner.id !== activeUser.id && (
            <span className="inline-flex items-center gap-1.5">
              <AvatarChip user={owner} size="sm" /> Owned by {owner.name}
            </span>
          )}
          <span aria-live="polite">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && lastSavedAt && `Saved · ${formatTime(lastSavedAt)}`}
            {saveState === "idle" && "\u00A0"}
          </span>
        </div>
      </div>

      {/* Read-only security banner */}
      {readOnly && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <span className="font-semibold">Read-Only Mode</span>
            <span className="ml-2 text-amber-800">
              {owner?.name ?? "The owner"} shared this document with you as a viewer. Editing,
              formatting, and file import are disabled.
            </span>
          </div>
          <Lock className="ml-auto h-4 w-4 shrink-0 text-amber-500" />
        </div>
      )}

      {/* Title */}
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleCommit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        readOnly={!editable}
        aria-label="Document title"
        placeholder="Untitled document"
        className={`w-full bg-transparent text-3xl font-bold tracking-tight text-slate-900 outline-none placeholder:text-slate-300 ${
          editable ? "border-b border-transparent focus:border-slate-200" : "cursor-default"
        }`}
      />

      {/* Formatting toolbar — hidden entirely in read-only mode */}
      {editable && (
        <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
          {toolbarButtons.map((btn) => (
            <button
              key={btn.label}
              title={btn.label}
              aria-label={btn.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={btn.onClick}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {btn.icon}
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <button
            title="Import .txt or .md file"
            aria-label="Import file"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <FileUp className="h-4 w-4" /> Import .txt / .md
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="hidden"
            onChange={handleFilePick}
          />
        </div>
      )}

      {uploadError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {uploadError}
        </p>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={editable ? scheduleSave : undefined}
        aria-label="Document canvas"
        aria-readonly={!editable}
        data-testid="editor-canvas"
        className={`prose-slate mt-4 min-h-[28rem] w-full rounded-xl border bg-white px-8 py-6 leading-7 shadow-sm outline-none [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.9em] ${
          editable
            ? "border-slate-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            : "border-slate-100 bg-slate-50/60 text-slate-700"
        }`}
      />

      <p className="mt-2 text-right text-xs text-slate-400">{wordCount} words</p>

      {/* Sharing — owner only */}
      {shareable && (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <UserPlus className="h-4 w-4 text-slate-500" /> Share this document
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={shareTarget}
              onChange={(e) => setShareTarget(e.target.value)}
              aria-label="Person to share with"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-300 focus:outline-none"
            >
              {candidateUsers.length === 0 && <option value="">Everyone has access</option>}
              {candidateUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <select
              value={shareRole}
              onChange={(e) => setShareRole(e.target.value as PermissionRole)}
              aria-label="Access role"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-300 focus:outline-none"
            >
              <option value="viewer">Viewer — read only</option>
              <option value="editor">Editor — can edit</option>
            </select>
            <button
              onClick={handleShare}
              disabled={!shareTarget}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Grant access
            </button>
          </div>

          {shareError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {shareError}
            </p>
          )}

          <ul className="mt-4 divide-y divide-slate-100">
            {doc.sharedWith.length === 0 && (
              <li className="py-2 text-sm text-slate-400">
                Not shared yet — only you can see this document.
              </li>
            )}
            {doc.sharedWith.map((perm) => {
              const user = getUserById(perm.userId);
              if (!user) return null;
              return (
                <li key={perm.userId} className="flex items-center gap-3 py-2.5">
                  <AvatarChip user={user} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                  </div>
                  <select
                    value={perm.role}
                    onChange={(e) =>
                      handleRoleChange(perm.userId, e.target.value as PermissionRole)
                    }
                    aria-label={`Role for ${user.name}`}
                    className={`ml-auto rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none ${
                      perm.role === "editor"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button
                    onClick={() => handleRevoke(perm.userId)}
                    aria-label={`Revoke access for ${user.name}`}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
