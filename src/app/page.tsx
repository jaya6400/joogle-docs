"use client";

/**
 * Project hub — the main landing surface.
 *
 * Features the Identity Context Simulator (top navbar) for instantly
 * switching between the three pre-seeded profiles, plus two isolated
 * document lanes: "My Documents" (owned) and "Shared With Me".
 *
 * Client/server boundary: this page is a client component because the
 * persistence engine lives in localStorage; the parent layout.tsx
 * remains a server component.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileText,
  Lock,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { DocumentItem, User, resolveAccess } from "@/types";
import {
  createDocument,
  deleteDocument,
  ensureSeeded,
  getOwnedDocuments,
  getSharedDocuments,
  getUserById,
  getUsers,
  resetStore,
  setActiveUser,
  getActiveUser,
  subscribe,
} from "@/utils/storage";
import DocumentEditor from "@/components/DocumentEditor";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function snippet(html: string, max = 110): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "Empty document";
}

function AvatarChip({ user }: { user: User }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
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

/* ------------------------------------------------------------------ */
/* Identity Context Simulator                                          */
/* ------------------------------------------------------------------ */

function IdentitySwitcher({
  activeUser,
  users,
  onSwitch,
}: {
  activeUser: User;
  users: User[];
  onSwitch: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <span className="pointer-events-none absolute -top-2.5 left-3 z-10 rounded bg-amber-400 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-950">
        Identity Context Simulator
      </span>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm transition hover:border-slate-300"
      >
        <AvatarChip user={activeUser} />
        <span className="text-left leading-tight">
          <span className="block text-sm font-semibold text-slate-900">{activeUser.name}</span>
          <span className="block text-[11px] text-slate-400">{activeUser.email}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Switch identity"
          className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <li className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Review as… (no sign-in required)
          </li>
          {users.map((user) => {
            const isActive = user.id === activeUser.id;
            return (
              <li key={user.id}>
                <button
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onSwitch(user.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                    isActive ? "bg-blue-50/60" : ""
                  }`}
                >
                  <AvatarChip user={user} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {user.name}
                      </span>
                      {user.isPrimary && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          Primary Account
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-slate-400">{user.email}</span>
                  </span>
                  {isActive && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Document cards                                                      */
/* ------------------------------------------------------------------ */

function DocumentCard({
  doc,
  activeUser,
  variant,
  onOpen,
  onDelete,
}: {
  doc: DocumentItem;
  activeUser: User;
  variant: "owned" | "shared";
  onOpen: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const owner = getUserById(doc.ownerId);
  const access = resolveAccess(doc, activeUser.id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(doc.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(doc.id)}
      className="group flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-blue-50 group-hover:text-blue-600">
          <FileText className="h-4.5 w-4.5 h-[18px] w-[18px]" />
        </span>
        {variant === "owned" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
            <PenLine className="h-3 w-3" /> Owner
          </span>
        ) : access === "editor" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <PenLine className="h-3 w-3" /> Editor
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            <Lock className="h-3 w-3" /> Viewer
          </span>
        )}
      </div>
      <h3 className="mt-3 truncate text-sm font-semibold text-slate-900">{doc.title}</h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-slate-500">
        {snippet(doc.content)}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="truncate text-[11px] text-slate-400">
          {variant === "shared" && owner ? `${owner.name} · ` : ""}
          {relativeTime(doc.updatedAt)}
        </span>
        {variant === "owned" && onDelete && (
          <button
            aria-label={`Delete ${doc.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(doc.id);
            }}
            className="rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hub page                                                            */
/* ------------------------------------------------------------------ */

export default function HubPage() {
  const [mounted, setMounted] = useState(false);
  const [activeUser, setActiveUserState] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [owned, setOwned] = useState<DocumentItem[]>([]);
  const [shared, setShared] = useState<DocumentItem[]>([]);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    ensureSeeded();
    const user = getActiveUser();
    setActiveUserState(user);
    setUsers(getUsers());
    setOwned(getOwnedDocuments(user.id));
    setShared(getSharedDocuments(user.id));
  }, []);

  useEffect(() => {
    refresh();
    setMounted(true);
    return subscribe(refresh);
  }, [refresh]);

  const handleSwitchIdentity = useCallback((userId: string) => {
    setActiveUser(userId);
    setOpenDocId(null); // return to hub so permission states are visible
  }, []);

  const handleCreate = useCallback(() => {
    if (!activeUser) return;
    const doc = createDocument(activeUser.id);
    setOpenDocId(doc.id);
  }, [activeUser]);

  const handleDelete = useCallback(
    (docId: string) => {
      if (!activeUser) return;
      if (confirmDeleteId === docId) {
        try {
          deleteDocument(docId, activeUser.id);
        } catch {
          /* guarded in storage layer */
        }
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(docId);
        window.setTimeout(() => setConfirmDeleteId((id) => (id === docId ? null : id)), 3000);
      }
    },
    [activeUser, confirmDeleteId]
  );

  /* SSR guard: localStorage only exists client-side. */
  if (!mounted || !activeUser) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading Joogle Docs…
      </div>
    );
  }

  if (openDocId) {
    return (
      <>
        <Navbar
          activeUser={activeUser}
          users={users}
          onSwitch={handleSwitchIdentity}
        />
        <DocumentEditor
          key={`${openDocId}:${activeUser.id}`}
          documentId={openDocId}
          activeUser={activeUser}
          onBack={() => setOpenDocId(null)}
        />
      </>
    );
  }

  return (
    <>
      <Navbar activeUser={activeUser} users={users} onSwitch={handleSwitchIdentity} />

      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        {/* Heading row */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Welcome back, {activeUser.name.split(" ")[0]}
            </h1>
            <p className="text-sm text-slate-500">
              Documents persist locally — refresh, or switch identity to verify sharing states.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => resetStore()}
              title="Reseed demo data"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo
            </button>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" /> New document
            </button>
          </div>
        </div>

        {/* Lane: owned */}
        <section aria-label="My documents">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <FileText className="h-3.5 w-3.5" /> My Documents
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              {owned.length}
            </span>
          </h2>
          {owned.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-400">
              No documents yet — create your first one.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {owned.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  activeUser={activeUser}
                  variant="owned"
                  onOpen={setOpenDocId}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>

        {/* Lane: shared with me */}
        <section aria-label="Shared with me" className="mt-10">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" /> Shared With Me
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              {shared.length}
            </span>
          </h2>
          {shared.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-400">
              Nothing shared with {activeUser.name.split(" ")[0]} yet. Switch identity to Alex or
              share a document with them to see this lane populate.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  activeUser={activeUser}
                  variant="shared"
                  onOpen={setOpenDocId}
                />
              ))}
            </div>
          )}
        </section>

        {confirmDeleteId && (
          <p role="alert" className="mt-6 text-center text-xs text-red-500">
            Click the trash icon again to confirm deletion.
          </p>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Top navbar                                                          */
/* ------------------------------------------------------------------ */

function Navbar({
  activeUser,
  users,
  onSwitch,
}: {
  activeUser: User;
  users: User[];
  onSwitch: (userId: string) => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
            A
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-tight text-slate-900">
              Joogle Docs
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Internal pilot
            </span>
          </span>
        </div>
        <IdentitySwitcher activeUser={activeUser} users={users} onSwitch={onSwitch} />
      </div>
    </header>
  );
}
