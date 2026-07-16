/**
 * Access-rights and lock-rule verification for the Joogle Docs data layer.
 *
 * Covers the three clearance paths from the spec:
 *   owner          → full read/write
 *   shared editor  → full read/write
 *   shared viewer  → read-only (canvas locked, toolbar hidden upstream)
 * plus storage-level guardrails (share/delete administration is owner-only).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DocumentItem,
  canEdit,
  canShare,
  canView,
  isReadOnly,
  resolveAccess,
} from "@/types";
import { importTextToHtml } from "@/components/DocumentEditor";
import {
  SEED_USERS,
  createDocument,
  deleteDocument,
  getActiveUser,
  getDocument,
  getOwnedDocuments,
  getSharedDocuments,
  getUsers,
  resetStore,
  revokeAccess,
  setActiveUser,
  shareDocument,
  updateDocument,
} from "@/utils/storage";

const [alex, sarah, marcus] = SEED_USERS;

function makeDoc(sharedWith: DocumentItem["sharedWith"] = []): DocumentItem {
  const stamp = new Date().toISOString();
  return {
    id: "doc_test",
    title: "Test",
    content: "<p>hello</p>",
    ownerId: alex.id,
    sharedWith,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

beforeEach(() => {
  resetStore();
});

/* ------------------------------------------------------------------ */
/* Seeded identities                                                   */
/* ------------------------------------------------------------------ */

describe("seeded identities", () => {
  it("seeds exactly the three mandated profiles", () => {
    const users = getUsers();
    expect(users).toHaveLength(3);
    expect(users.map((u) => u.email)).toEqual([
      "alex@Joogle.internal",
      "sarah@Joogle.internal",
      "marcus@Joogle.internal",
    ]);
    expect(users.find((u) => u.isPrimary)?.name).toBe("Alex Rivera");
  });

  it("defaults the active identity to the primary account and persists switches", () => {
    expect(getActiveUser().email).toBe("alex@Joogle.internal");
    setActiveUser(sarah.id);
    expect(getActiveUser().email).toBe("sarah@Joogle.internal");
  });

  it("rejects switching to an unknown identity", () => {
    expect(() => setActiveUser("u_ghost")).toThrow(/unknown user/i);
  });
});

/* ------------------------------------------------------------------ */
/* Pure access resolution                                              */
/* ------------------------------------------------------------------ */

describe("resolveAccess / clearance helpers", () => {
  it("grants the owner full clearance", () => {
    const doc = makeDoc();
    expect(resolveAccess(doc, alex.id)).toBe("owner");
    expect(canEdit(doc, alex.id)).toBe(true);
    expect(isReadOnly(doc, alex.id)).toBe(false);
    expect(canShare(doc, alex.id)).toBe(true);
  });

  it("grants a shared editor full read/write clearance", () => {
    const doc = makeDoc([
      { userId: sarah.id, role: "editor", grantedAt: "", grantedBy: alex.id },
    ]);
    expect(resolveAccess(doc, sarah.id)).toBe("editor");
    expect(canEdit(doc, sarah.id)).toBe(true);
    expect(isReadOnly(doc, sarah.id)).toBe(false);
    expect(canShare(doc, sarah.id)).toBe(false); // editors may not administer sharing
  });

  it("locks a shared viewer into read-only mode", () => {
    const doc = makeDoc([
      { userId: marcus.id, role: "viewer", grantedAt: "", grantedBy: alex.id },
    ]);
    expect(resolveAccess(doc, marcus.id)).toBe("viewer");
    expect(canView(doc, marcus.id)).toBe(true);
    expect(canEdit(doc, marcus.id)).toBe(false);
    expect(isReadOnly(doc, marcus.id)).toBe(true);
  });

  it("denies users with no grant entirely", () => {
    const doc = makeDoc();
    expect(resolveAccess(doc, marcus.id)).toBe("none");
    expect(canView(doc, marcus.id)).toBe(false);
    expect(canEdit(doc, marcus.id)).toBe(false);
  });

  it("owner clearance always wins, even with a stray grant row", () => {
    const doc = makeDoc([
      { userId: alex.id, role: "viewer", grantedAt: "", grantedBy: alex.id },
    ]);
    expect(resolveAccess(doc, alex.id)).toBe("owner");
  });
});

/* ------------------------------------------------------------------ */
/* Storage-level lock rules                                            */
/* ------------------------------------------------------------------ */

describe("storage lock rules", () => {
  it("lets an editor mutate content but blocks a viewer and a stranger", () => {
    const doc = createDocument(alex.id, "Spec");
    shareDocument(doc.id, alex.id, sarah.id, "editor");
    shareDocument(doc.id, alex.id, marcus.id, "viewer");

    const updated = updateDocument(doc.id, sarah.id, { content: "<p>edited</p>" });
    expect(updated.content).toBe("<p>edited</p>");
    expect(updated.updatedAt >= doc.updatedAt).toBe(true);

    expect(() => updateDocument(doc.id, marcus.id, { content: "<p>nope</p>" })).toThrow(
      /permission denied/i
    );
    expect(() => updateDocument(doc.id, "u_ghost", { content: "<p>nope</p>" })).toThrow(
      /permission denied/i
    );
    // The blocked writes must not have landed.
    expect(getDocument(doc.id)?.content).toBe("<p>edited</p>");
  });

  it("allows only the owner to share, re-role, revoke, or delete", () => {
    const doc = createDocument(alex.id, "Guarded");
    shareDocument(doc.id, alex.id, sarah.id, "editor");

    // Editors cannot escalate into share administration.
    expect(() => shareDocument(doc.id, sarah.id, marcus.id, "viewer")).toThrow(
      /only the owner/i
    );
    expect(() => revokeAccess(doc.id, sarah.id, marcus.id)).toThrow(/only the owner/i);
    expect(() => deleteDocument(doc.id, sarah.id)).toThrow(/only the owner/i);

    // Owner can re-role viewer → editor and back, then revoke entirely.
    shareDocument(doc.id, alex.id, marcus.id, "viewer");
    expect(resolveAccess(getDocument(doc.id)!, marcus.id)).toBe("viewer");
    shareDocument(doc.id, alex.id, marcus.id, "editor");
    expect(resolveAccess(getDocument(doc.id)!, marcus.id)).toBe("editor");
    revokeAccess(doc.id, alex.id, marcus.id);
    expect(resolveAccess(getDocument(doc.id)!, marcus.id)).toBe("none");

    // Owner delete succeeds.
    deleteDocument(doc.id, alex.id);
    expect(getDocument(doc.id)).toBeUndefined();
  });

  it("rejects sharing with the owner or with unknown users", () => {
    const doc = createDocument(alex.id);
    expect(() => shareDocument(doc.id, alex.id, alex.id, "viewer")).toThrow(/own owner/i);
    expect(() => shareDocument(doc.id, alex.id, "u_ghost", "viewer")).toThrow(
      /unknown user/i
    );
  });

  it("persists documents across simulated refreshes (store round-trip)", () => {
    const doc = createDocument(alex.id, "Durable");
    updateDocument(doc.id, alex.id, { content: "<p>still here</p>" });
    // A fresh read through the storage layer == what a refresh would see.
    const reloaded = getDocument(doc.id);
    expect(reloaded?.title).toBe("Durable");
    expect(reloaded?.content).toBe("<p>still here</p>");
  });
});

/* ------------------------------------------------------------------ */
/* Multi-identity lane isolation (hub queries)                         */
/* ------------------------------------------------------------------ */

describe("personal vs. shared lanes per identity", () => {
  it("isolates owned and shared arrays for each seeded identity", () => {
    // Seeded demo: Alex owns 1 doc, Sarah shares to Alex (viewer), Marcus shares to Alex (editor).
    expect(getOwnedDocuments(alex.id).map((d) => d.id)).toEqual(["doc_launch_plan"]);

    const alexShared = getSharedDocuments(alex.id);
    expect(alexShared).toHaveLength(2);
    expect(resolveAccess(alexShared.find((d) => d.id === "doc_design_notes")!, alex.id)).toBe(
      "viewer"
    );
    expect(
      resolveAccess(alexShared.find((d) => d.id === "doc_vendor_comparison")!, alex.id)
    ).toBe("editor");

    // Sarah: owns 1, sees Alex's launch plan as editor.
    expect(getOwnedDocuments(sarah.id)).toHaveLength(1);
    const sarahShared = getSharedDocuments(sarah.id);
    expect(sarahShared).toHaveLength(1);
    expect(canEdit(sarahShared[0], sarah.id)).toBe(true);

    // Marcus: owns 1, sees Alex's launch plan as locked viewer.
    const marcusShared = getSharedDocuments(marcus.id);
    expect(marcusShared).toHaveLength(1);
    expect(isReadOnly(marcusShared[0], marcus.id)).toBe(true);
  });

  it("moves a document into the target's shared lane immediately after granting", () => {
    const doc = createDocument(alex.id, "Fresh");
    expect(getSharedDocuments(sarah.id).some((d) => d.id === doc.id)).toBe(false);
    shareDocument(doc.id, alex.id, sarah.id, "viewer");
    expect(getSharedDocuments(sarah.id).some((d) => d.id === doc.id)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* File ingestion (.txt / .md → editor HTML)                           */
/* ------------------------------------------------------------------ */

describe("importTextToHtml", () => {
  it("converts markdown headings, bullets, and inline emphasis", () => {
    const html = importTextToHtml("# Title\n- one **bold** item\n- two\nplain *text*");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul><li>one <strong>bold</strong> item</li><li>two</li></ul>");
    expect(html).toContain("<p>plain <em>text</em></p>");
  });

  it("converts numbered lists", () => {
    const html = importTextToHtml("1. first\n2. second");
    expect(html).toBe("<ol><li>first</li><li>second</li></ol>");
  });

  it("escapes raw HTML so imports cannot inject markup", () => {
    const html = importTextToHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
