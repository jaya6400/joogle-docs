/**
 * LocalStorage persistence engine for Joogle Docs.
 *
 * Mimics a relational schema in three "tables" (keys):
 *   Joogle.users.v1      → User[]
 *   Joogle.documents.v1  → DocumentItem[] (with embedded DocumentPermission join rows)
 *   Joogle.session.v1    → active identity id (powers the Identity Context Simulator)
 *
 * Every mutation is guarded here — not just in the UI — so access rules
 * hold regardless of which component calls the layer. All functions are
 * SSR-safe: on the server they operate against an in-memory fallback.
 */

import {
  AccessLevel,
  DocumentItem,
  DocumentPermission,
  PermissionRole,
  User,
  resolveAccess,
} from "@/types";

const USERS_KEY = "Joogle.users.v1";
const DOCS_KEY = "Joogle.documents.v1";
const SESSION_KEY = "Joogle.session.v1";
const CHANGE_EVENT = "Joogle:store-changed";

/* ------------------------------------------------------------------ */
/* Seeded identities                                                   */
/* ------------------------------------------------------------------ */

export const SEED_USERS: User[] = [
  {
    id: "u_alex",
    name: "Alex Rivera",
    email: "alex@Joogle.internal",
    avatarColor: "#2563eb",
    isPrimary: true,
  },
  {
    id: "u_sarah",
    name: "Sarah Chen",
    email: "sarah@Joogle.internal",
    avatarColor: "#059669",
    isPrimary: false,
  },
  {
    id: "u_marcus",
    name: "Marcus Vance",
    email: "marcus@Joogle.internal",
    avatarColor: "#d97706",
    isPrimary: false,
  },
];

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

/** In-memory fallback so SSR / test environments without localStorage never crash. */
const memoryFallback = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  if (hasLocalStorage()) return window.localStorage.getItem(key);
  return memoryFallback.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  if (hasLocalStorage()) {
    window.localStorage.setItem(key, value);
  } else {
    memoryFallback.set(key, value);
  }
  notifyChange();
}

function readTable<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function makeId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Change feed (tiny pub/sub over a CustomEvent)                       */
/* ------------------------------------------------------------------ */

export function notifyChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** Subscribe to any store mutation. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener); // cross-tab sync
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/* ------------------------------------------------------------------ */
/* Bootstrapping / seeding                                             */
/* ------------------------------------------------------------------ */

function seedDocuments(): DocumentItem[] {
  const stamp = nowIso();
  return [
    {
      id: "doc_launch_plan",
      title: "Q3 Launch Plan — Draft",
      content:
        "<h1>Q3 Launch Plan</h1><p>Draft brief for the Joogle Docs pilot. <strong>Sarah</strong> owns the rollout checklist; <strong>Marcus</strong> is reviewing vendor costs.</p><ul><li>Finalize editing surface</li><li>Dogfood sharing flows</li><li>Prepare launch comms</li></ul>",
      ownerId: "u_alex",
      sharedWith: [
        { userId: "u_sarah", role: "editor", grantedAt: stamp, grantedBy: "u_alex" },
        { userId: "u_marcus", role: "viewer", grantedAt: stamp, grantedBy: "u_alex" },
      ],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "doc_design_notes",
      title: "Design Critique Notes",
      content:
        "<h2>Design Critique — Editor Surface</h2><p>Toolbar should stay under <em>eight</em> controls. Read-only mode needs an unmistakable banner.</p>",
      ownerId: "u_sarah",
      sharedWith: [
        { userId: "u_alex", role: "viewer", grantedAt: stamp, grantedBy: "u_sarah" },
      ],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "doc_vendor_comparison",
      title: "Vendor Comparison Matrix",
      content:
        "<h2>Storage Vendor Shortlist</h2><p>Shared with Alex for edits. Numbers are directional only.</p><ol><li>Option A — managed</li><li>Option B — self-hosted</li></ol>",
      ownerId: "u_marcus",
      sharedWith: [
        { userId: "u_alex", role: "editor", grantedAt: stamp, grantedBy: "u_marcus" },
      ],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
}

/** Idempotent bootstrap: seeds users and demo documents on first run. */
export function ensureSeeded(): void {
  if (!readRaw(USERS_KEY)) {
    writeRaw(USERS_KEY, JSON.stringify(SEED_USERS));
  }
  if (!readRaw(DOCS_KEY)) {
    writeRaw(DOCS_KEY, JSON.stringify(seedDocuments()));
  }
  if (!readRaw(SESSION_KEY)) {
    writeRaw(SESSION_KEY, JSON.stringify(SEED_USERS[0].id));
  }
}

/** Wipe everything and reseed (used by tests and the "Reset demo" affordance). */
export function resetStore(): void {
  if (hasLocalStorage()) {
    window.localStorage.removeItem(USERS_KEY);
    window.localStorage.removeItem(DOCS_KEY);
    window.localStorage.removeItem(SESSION_KEY);
  } else {
    memoryFallback.clear();
  }
  ensureSeeded();
  notifyChange();
}

/* ------------------------------------------------------------------ */
/* Users & session                                                     */
/* ------------------------------------------------------------------ */

export function getUsers(): User[] {
  ensureSeeded();
  return readTable<User[]>(USERS_KEY, SEED_USERS);
}

export function getUserById(id: string): User | undefined {
  return getUsers().find((u) => u.id === id);
}

export function getActiveUserId(): string {
  ensureSeeded();
  return readTable<string>(SESSION_KEY, SEED_USERS[0].id);
}

export function getActiveUser(): User {
  const id = getActiveUserId();
  return getUserById(id) ?? SEED_USERS[0];
}

export function setActiveUser(userId: string): void {
  if (!getUserById(userId)) throw new Error(`Unknown user: ${userId}`);
  writeRaw(SESSION_KEY, JSON.stringify(userId));
}

/* ------------------------------------------------------------------ */
/* Document queries                                                    */
/* ------------------------------------------------------------------ */

export function getDocuments(): DocumentItem[] {
  ensureSeeded();
  return readTable<DocumentItem[]>(DOCS_KEY, []);
}

export function getDocument(id: string): DocumentItem | undefined {
  return getDocuments().find((d) => d.id === id);
}

/** Documents owned by the user, most recently updated first. */
export function getOwnedDocuments(userId: string): DocumentItem[] {
  return getDocuments()
    .filter((d) => d.ownerId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Documents shared with the user (any role), most recently updated first. */
export function getSharedDocuments(userId: string): DocumentItem[] {
  return getDocuments()
    .filter((d) => d.ownerId !== userId && d.sharedWith.some((p) => p.userId === userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getAccessFor(docId: string, userId: string): AccessLevel {
  const doc = getDocument(docId);
  if (!doc) return "none";
  return resolveAccess(doc, userId);
}

/* ------------------------------------------------------------------ */
/* Document mutations (guarded)                                        */
/* ------------------------------------------------------------------ */

function persistDocuments(docs: DocumentItem[]): void {
  writeRaw(DOCS_KEY, JSON.stringify(docs));
}

export function createDocument(ownerId: string, title = "Untitled document"): DocumentItem {
  if (!getUserById(ownerId)) throw new Error(`Unknown owner: ${ownerId}`);
  const stamp = nowIso();
  const doc: DocumentItem = {
    id: makeId("doc"),
    title,
    content: "<p><br></p>",
    ownerId,
    sharedWith: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  persistDocuments([...getDocuments(), doc]);
  return doc;
}

/**
 * Update title/content. Only the owner or a user with an 'editor' grant may mutate.
 * Throws on permission violation so callers cannot silently bypass lock rules.
 */
export function updateDocument(
  id: string,
  actorId: string,
  patch: Partial<Pick<DocumentItem, "title" | "content">>
): DocumentItem {
  const docs = getDocuments();
  const index = docs.findIndex((d) => d.id === id);
  if (index === -1) throw new Error(`Document not found: ${id}`);
  const doc = docs[index];
  const access = resolveAccess(doc, actorId);
  if (access !== "owner" && access !== "editor") {
    throw new Error("Permission denied: this identity has read-only or no access.");
  }
  const updated: DocumentItem = { ...doc, ...patch, updatedAt: nowIso() };
  docs[index] = updated;
  persistDocuments(docs);
  return updated;
}

/** Owner-only delete. */
export function deleteDocument(id: string, actorId: string): void {
  const doc = getDocument(id);
  if (!doc) return;
  if (doc.ownerId !== actorId) {
    throw new Error("Permission denied: only the owner can delete this document.");
  }
  persistDocuments(getDocuments().filter((d) => d.id !== id));
}

function mutateShare(
  docId: string,
  actorId: string,
  mutate: (sharedWith: DocumentPermission[]) => DocumentPermission[]
): DocumentItem {
  const docs = getDocuments();
  const index = docs.findIndex((d) => d.id === docId);
  if (index === -1) throw new Error(`Document not found: ${docId}`);
  const doc = docs[index];
  if (doc.ownerId !== actorId) {
    throw new Error("Permission denied: only the owner can manage sharing.");
  }
  const updated: DocumentItem = {
    ...doc,
    sharedWith: mutate(doc.sharedWith),
    updatedAt: nowIso(),
  };
  docs[index] = updated;
  persistDocuments(docs);
  return updated;
}

/** Grant (or re-grant) access. Owner-only; sharing with the owner is a no-op error. */
export function shareDocument(
  docId: string,
  actorId: string,
  targetUserId: string,
  role: PermissionRole
): DocumentItem {
  if (!getUserById(targetUserId)) throw new Error(`Unknown user: ${targetUserId}`);
  return mutateShare(docId, actorId, (sharedWith) => {
    if (targetUserId === actorId) {
      throw new Error("Cannot share a document with its own owner.");
    }
    const existing = sharedWith.find((p) => p.userId === targetUserId);
    if (existing) {
      return sharedWith.map((p) => (p.userId === targetUserId ? { ...p, role } : p));
    }
    return [
      ...sharedWith,
      { userId: targetUserId, role, grantedAt: nowIso(), grantedBy: actorId },
    ];
  });
}

/** Revoke a user's access. Owner-only. */
export function revokeAccess(docId: string, actorId: string, targetUserId: string): DocumentItem {
  return mutateShare(docId, actorId, (sharedWith) =>
    sharedWith.filter((p) => p.userId !== targetUserId)
  );
}
