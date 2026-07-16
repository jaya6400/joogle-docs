/**
 * Domain schemas for Joogle Docs.
 *
 * The shapes below deliberately mirror a relational data model
 * (users 1—n documents, documents n—n users via a permission join
 * table) so the localStorage persistence engine can later be swapped
 * for a real database without touching UI code.
 */

/** Roles grantable on a shared document. The owner is implicit (DocumentItem.ownerId). */
export type PermissionRole = "editor" | "viewer";

/** A system identity. Three of these are pre-seeded by the storage layer. */
export interface User {
  id: string;
  name: string;
  email: string;
  /** Hex color used for the avatar chip in the identity switcher and share list. */
  avatarColor: string;
  /** Marks the primary demo account (Alex Rivera). */
  isPrimary: boolean;
}

/** Join-table row: grants `userId` a `role` on a document. */
export interface DocumentPermission {
  userId: string;
  role: PermissionRole;
  /** ISO-8601 timestamp of when access was granted. */
  grantedAt: string;
  /** userId of the owner who granted access. */
  grantedBy: string;
}

/** A document row. `content` holds sanitized HTML produced by the contentEditable canvas. */
export interface DocumentItem {
  id: string;
  title: string;
  content: string;
  ownerId: string;
  sharedWith: DocumentPermission[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Effective clearance of a user against a document:
 * - "owner"  → full read/write + share administration
 * - "editor" → full read/write
 * - "viewer" → read-only (toolbar hidden, canvas locked)
 * - "none"   → no access at all
 */
export type AccessLevel = "owner" | "editor" | "viewer" | "none";

/** Resolve the effective access level of `userId` for `doc`. Owner always wins. */
export function resolveAccess(doc: DocumentItem, userId: string): AccessLevel {
  if (doc.ownerId === userId) return "owner";
  const grant = doc.sharedWith.find((p) => p.userId === userId);
  return grant ? grant.role : "none";
}

/** True when the user may mutate document content (owner or editor grant). */
export function canEdit(doc: DocumentItem, userId: string): boolean {
  const access = resolveAccess(doc, userId);
  return access === "owner" || access === "editor";
}

/** True when the user can open the document but the canvas must be locked. */
export function isReadOnly(doc: DocumentItem, userId: string): boolean {
  return resolveAccess(doc, userId) === "viewer";
}

/** True when the user may open the document at all. */
export function canView(doc: DocumentItem, userId: string): boolean {
  return resolveAccess(doc, userId) !== "none";
}

/** True only for the owner — sharing administration is owner-exclusive. */
export function canShare(doc: DocumentItem, userId: string): boolean {
  return doc.ownerId === userId;
}
