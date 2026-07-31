/*
  Floor sections ("zones") for the table grid — Patio / Main Hall / Rooftop …

  WHERE THE TRUTH LIVES
  ---------------------
  On the SERVER, in one nullable text column: `Tables.section`. A section is
  nothing but the distinct set of values in that column — there is no Sections
  table — so moving a table between zones is ONE single-row write
  (`PATCH /table/:name { section }`) and never a bulk floor rewrite. Membership
  therefore survives a reload, a different browser and a different device.

  WHAT IS STILL LOCAL, AND WHY
  ----------------------------
  Two things the column cannot express:
    * the ORDER of cards inside a section, and the order of the sections
      themselves — there is no position column, and inventing one would mean
      writing every row on every drop;
    * a section that has just been created and holds NO tables yet. Server-side
      such a section does not exist (nothing carries the label), so it is held
      here until the first table is dropped into it, at which point the PATCH
      makes it real.
  Both are presentation hints: losing them costs a bit of arrangement, never a
  table's zone. `applyServerSections` always lets the server win on membership.
*/

/** A named zone plus the tables it holds, in the order they are shown. */
export interface TableSection {
  id: string;
  name: string;
  /** Lowercased table names, in display order. */
  tables: string[];
}

export interface TableLayout {
  sections: TableSection[];
}

/** The two fields of a table this module cares about. */
export interface SectionedTable {
  name: string;
  /** Server value of `Tables.section`; null/absent = unassigned. */
  section?: string | null;
}

/**
 * Reserved first section. It is the absence of a label rather than a label, can
 * never be renamed or deleted, and tables fall back into it when their section
 * is removed.
 */
export const UNASSIGNED_SECTION_ID = "__unassigned";
export const UNASSIGNED_SECTION_NAME = "Unassigned";

/** Longest name the backend keeps (it truncates past this). */
export const SECTION_NAME_MAX = 60;

const STORAGE_PREFIX = "rd:table-sections:";

const storageKey = (restaurantId: string, outletId?: string | null) =>
  `${STORAGE_PREFIX}${restaurantId}${outletId ? `:${outletId}` : ""}`;

const emptyLayout = (): TableLayout => ({
  sections: [{ id: UNASSIGNED_SECTION_ID, name: UNASSIGNED_SECTION_NAME, tables: [] }],
});

export const isUnassignedSection = (sectionId: string) => sectionId === UNASSIGNED_SECTION_ID;

/**
 * Whitespace-collapsed and length-capped exactly the way the backend normalizes
 * it, so what we render is what the column will hold.
 */
export const normalizeSectionName = (name: string): string =>
  name.replace(/\s+/g, " ").trim().slice(0, SECTION_NAME_MAX);

/**
 * A section IS its name, matched case-insensitively (the backend matches on
 * `lower(section)`), so the display name doubles as the identity — there is no
 * client-side id to keep in sync with a column that has none.
 */
export const sectionIdForName = (name: string): string => {
  const normalized = normalizeSectionName(name).toLowerCase();
  return normalized ? normalized : UNASSIGNED_SECTION_ID;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

/**
 * Parse whatever is in storage without ever trusting its shape, then guarantee
 * the reserved section exists exactly once and sits first. Ids are recomputed
 * from the name, which also migrates layouts written by the earlier
 * browser-only version (those carried random `sec-<uuid>` ids).
 */
const normalizeLayout = (raw: unknown): TableLayout => {
  const sections: TableSection[] = [];
  const seenIds = new Set<string>();

  const rawSections = raw && typeof raw === "object" ? (raw as { sections?: unknown }).sections : null;
  for (const entry of Array.isArray(rawSections) ? rawSections : []) {
    if (!entry || typeof entry !== "object") {continue;}
    const candidate = entry as { id?: unknown; name?: unknown; tables?: unknown };
    const storedName = typeof candidate.name === "string" ? normalizeSectionName(candidate.name) : "";
    const reserved = candidate.id === UNASSIGNED_SECTION_ID || !storedName;
    const id = reserved ? UNASSIGNED_SECTION_ID : sectionIdForName(storedName);
    if (seenIds.has(id)) {continue;}
    seenIds.add(id);
    sections.push({
      id,
      name: reserved ? UNASSIGNED_SECTION_NAME : storedName,
      tables: asStringArray(candidate.tables).map((name) => name.toLowerCase()),
    });
  }

  const unassignedIndex = sections.findIndex((section) => isUnassignedSection(section.id));
  if (unassignedIndex < 0) {
    sections.unshift({ id: UNASSIGNED_SECTION_ID, name: UNASSIGNED_SECTION_NAME, tables: [] });
  } else if (unassignedIndex > 0) {
    const [reserved] = sections.splice(unassignedIndex, 1);
    sections.unshift(reserved);
  }

  return { sections };
};

export const loadLayout = (restaurantId: string, outletId?: string | null): TableLayout => {
  if (typeof window === "undefined") {return emptyLayout();}
  try {
    const stored = window.localStorage.getItem(storageKey(restaurantId, outletId));
    return stored ? normalizeLayout(JSON.parse(stored)) : emptyLayout();
  } catch {
    return emptyLayout();
  }
};

export const saveLayout = (restaurantId: string, outletId: string | null | undefined, layout: TableLayout) => {
  if (typeof window === "undefined") {return;}
  try {
    window.localStorage.setItem(storageKey(restaurantId, outletId), JSON.stringify(layout));
  } catch {
    // Private mode / quota — the in-memory layout still applies for this session
    // and, crucially, section MEMBERSHIP is on the server either way.
  }
};

/**
 * Fold the server's `Tables.section` values into the locally remembered
 * arrangement. THE SERVER WINS ON MEMBERSHIP: the stored layout only supplies
 * the order of the cards and of the sections, plus any section the owner
 * created that holds no tables yet (which cannot exist server-side).
 *
 * Also drops tables that no longer exist and files brand-new ones under the
 * section their row names, so a table is never invisible.
 */
export const applyServerSections = (layout: TableLayout, tables: SectionedTable[]): TableLayout => {
  // tableKey -> section id it belongs to according to the server.
  const owner = new Map<string, string>();
  // section id -> the name to display (server spelling wins over the stored one).
  const names = new Map<string, string>([[UNASSIGNED_SECTION_ID, UNASSIGNED_SECTION_NAME]]);

  for (const table of tables) {
    const label = typeof table.section === "string" ? normalizeSectionName(table.section) : "";
    const id = label ? sectionIdForName(label) : UNASSIGNED_SECTION_ID;
    if (label && !names.has(id)) {names.set(id, label);}
    owner.set(table.name.toLowerCase(), id);
  }

  // Sections in their remembered order first, then any the server knows about
  // that this browser has never seen.
  const ordered: TableSection[] = [];
  const byId = new Map<string, TableSection>();
  const push = (id: string, name: string) => {
    if (byId.has(id)) {return;}
    const section: TableSection = { id, name, tables: [] };
    byId.set(id, section);
    ordered.push(section);
  };

  push(UNASSIGNED_SECTION_ID, UNASSIGNED_SECTION_NAME);
  for (const section of layout.sections) {
    push(section.id, names.get(section.id) ?? section.name);
  }
  for (const [id, name] of names) {
    push(id, name);
  }

  // Cards: remembered order first (skipping any whose zone the server moved
  // elsewhere), then whatever the server listed and this browser had not seen.
  const placed = new Set<string>();
  const place = (key: string) => {
    const target = owner.get(key);
    if (target === undefined || placed.has(key)) {return;}
    const section = byId.get(target);
    if (!section) {return;}
    placed.add(key);
    section.tables.push(key);
  };

  for (const section of layout.sections) {
    for (const key of section.tables) {
      place(key);
    }
  }
  for (const table of tables) {
    place(table.name.toLowerCase());
  }

  return { sections: ordered };
};

/** Section id a table currently sits in (Unassigned when it is not placed). */
export const sectionIdForTable = (layout: TableLayout, tableName: string): string => {
  const key = tableName.toLowerCase();
  const owner = layout.sections.find((section) => section.tables.includes(key));
  return owner ? owner.id : UNASSIGNED_SECTION_ID;
};

/**
 * Move `tableName` into `targetSectionId`, dropped just before `beforeTable`
 * (or appended when that is null). Used for both cross-section drops and
 * reordering inside one section. Purely local — the caller PATCHes the row.
 */
export const moveTable = (
  layout: TableLayout,
  tableName: string,
  targetSectionId: string,
  beforeTable: string | null,
): TableLayout => {
  const key = tableName.toLowerCase();
  const beforeKey = beforeTable ? beforeTable.toLowerCase() : null;
  if (beforeKey === key) {return layout;}
  if (!layout.sections.some((section) => section.id === targetSectionId)) {return layout;}

  const stripped = layout.sections.map((section) => ({
    ...section,
    tables: section.tables.filter((name) => name !== key),
  }));

  return {
    sections: stripped.map((section) => {
      if (section.id !== targetSectionId) {return section;}
      const tables = [...section.tables];
      const at = beforeKey ? tables.indexOf(beforeKey) : -1;
      if (at < 0) {
        tables.push(key);
      } else {
        tables.splice(at, 0, key);
      }
      return { ...section, tables };
    }),
  };
};

/**
 * Add an EMPTY section. Nothing is written to the server: with no table
 * carrying the label there is no row to put it on. It becomes real (and
 * therefore visible to every other device) the moment a table is dropped in.
 */
export const addSection = (layout: TableLayout, name: string): TableLayout => {
  const trimmed = normalizeSectionName(name);
  const id = sectionIdForName(trimmed);
  if (isUnassignedSection(id) || layout.sections.some((section) => section.id === id)) {return layout;}
  return { sections: [...layout.sections, { id, name: trimmed, tables: [] }] };
};

export const renameSection = (layout: TableLayout, sectionId: string, name: string): TableLayout => {
  if (isUnassignedSection(sectionId)) {return layout;}
  const trimmed = normalizeSectionName(name);
  if (!trimmed) {return layout;}
  const nextId = sectionIdForName(trimmed);
  if (nextId !== sectionId && layout.sections.some((section) => section.id === nextId)) {return layout;}
  return {
    sections: layout.sections.map((section) =>
      section.id === sectionId ? { ...section, id: nextId, name: trimmed } : section,
    ),
  };
};

/** Delete a section; its tables fall back to Unassigned rather than vanishing. */
export const removeSection = (layout: TableLayout, sectionId: string): TableLayout => {
  if (isUnassignedSection(sectionId)) {return layout;}
  const doomed = layout.sections.find((section) => section.id === sectionId);
  if (!doomed) {return layout;}

  return {
    sections: layout.sections
      .filter((section) => section.id !== sectionId)
      .map((section) =>
        isUnassignedSection(section.id)
          ? { ...section, tables: [...section.tables, ...doomed.tables] }
          : section,
      ),
  };
};
