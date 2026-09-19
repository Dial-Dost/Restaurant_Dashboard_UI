/*
  2.1 AND 5.1, PINNED AGAINST THE PAGES THAT ANSWER THEM.

  2.1: "…make sure what is seen in Tables is not shown in the Floor Plan." The
  floor-plan tile used to repaint the live floor — In use / Reserved / Free,
  the occupancy tints, the clubbed-booking badge. The layout editor now draws
  furniture only, and the Tables page still draws no layout control.

  5.1: "Ensure the restaurant's logo, address, and GSTIN number are clearly
  visible on both the print preview and the final printed customer bill." The
  preview card inherited the dark theme (white ink that a browser prints on white
  paper), the header lines were muted grey, the logo was a 64px box, and a tenant
  with no logo got "Loading Logo ..." printed on their bill.

  These are page components with no DOM test harness in this repo (jest runs in
  node over src/lib), so they are pinned the way palette.test.ts pins CSS: by
  reading the source.
*/

function readSource(relative: string): string {
   
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  for (const base of [process.cwd(), path.join(__dirname, "..", "..", "..")]) {
    const full = path.join(base, relative);
    if (fs.existsSync(full)) { return fs.readFileSync(full, "utf8"); }
  }
  throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/**
 * Source with comments removed, so a pin reads the CODE. The comments beside
 * these fixes quote the very words the pins forbid ("Loading Logo", "occupancy").
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The source of one top-level function component, up to the next one. */
function componentBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const next = src.indexOf("\nfunction ", at + 1);
  const nextExport = src.indexOf("\nexport ", at + 1);
  const ends = [next, nextExport].filter((i) => i > at);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

describe("2.1 — the floor plan does not repeat the Tables screen", () => {
  const floor = code(readSource("src/app/dashboard/floor-plan/page.tsx"));
  // The rebuilt tile is two components: the card it draws and the draggable button around it.
  const tile = componentBody(floor, "PlanTileCard") + componentBody(floor, "PlanTile");

  it("a floor-plan tile takes no occupancy and no booking", () => {
    expect(tile).not.toMatch(/occupancy/);
    expect(tile).not.toMatch(/combined/);
  });

  it("and paints no live state: no In use / Reserved / Free, no occupancy tint, no seated note", () => {
    for (const live of ['"In use"', '"Reserved"', '"Free"', "bg-red-950", "bg-blue-950", "party is seated", "Clubbed with"]) {
      expect(tile).not.toContain(live);
    }
  });

  it("it still shows what a layout needs: the name, the seats, the grip and Edit seating", () => {
    expect(tile).toContain("{row.name}");
    expect(tile).toContain("seatsLabel(row.raw)");
    expect(tile).toContain("GripVertical");
    expect(tile).toContain("Tap to edit seating");
  });

  it("no caller hands a tile the live floor", () => {
    expect(floor).not.toMatch(/<PlanTile[^>]*occupancy=/);
    expect(floor).not.toMatch(/combinedByName/);
  });
});

describe("2.1 — the Tables screen still offers no layout control", () => {
  const tables = code(readSource("src/app/dashboard/tables/page.tsx"));

  it("nothing on it can be dragged", () => {
    expect(tables).not.toMatch(/@dnd-kit/);
    expect(tables).not.toMatch(/useSortable|useDraggable|useDroppable|draggable=|onDragStart|onDrop=/);
  });

  it("and it calls no layout route", () => {
    for (const route of ["/add-table", "/table-sections", 'method: "DELETE"', "updateTableSeating", "GripVertical"]) {
      expect(tables).not.toContain(route);
    }
  });
});

describe("5.1 — the print preview shows the logo, address and GSTIN clearly", () => {
  const print = code(readSource("src/app/dashboard/orders/print/page.tsx"));

  it("the receipt is black ink on white whatever the dashboard theme", () => {
    expect(print).toMatch(/<Card className=\{?[`"][^`"]*receipt-card[^`"]*\bbg-white\b[^`"]*\btext-black\b/);
  });

  it("the address/GSTIN lines are black, not the muted description grey", () => {
    const at = print.indexOf("billHeaderLines(profile, billPrint).map(");
    expect(at).toBeGreaterThan(-1);
    const opening = print.lastIndexOf("<CardDescription", at);
    expect(print.slice(opening, at)).toMatch(/className="[^"]*\btext-black\b/);
  });

  it("the logo is sized to read, not squeezed into a 64px box", () => {
    const img = /<Image src=\{`data:image\/png;base64,\$\{logoBase64\}`\}[^>]*\/>/.exec(print)?.[0] ?? "";
    expect(img).not.toBe("");
    expect(img).not.toMatch(/\bh-16\b/);
    expect(img).not.toMatch(/width=\{64\}/);
    // At the width the ROLL prints it — the client's bill carries its wordmark
    // at about two thirds of the paper with white either side, and bill_logo.ts
    // rasterises to that. Two thirds of the paper is 384 of the 528 dots between
    // the margins (72.73%): the cap before the image loads, and billLogoFit's
    // exact never-enlarged width once it has.
    expect(img).toMatch(/max-w-\[72\.73%\]/);
    expect(img).not.toMatch(/max-w-\[80%\]/);
    expect(img).toContain("onLoad={onLogoLoad}");
    expect(img).toContain("style={{ width: logoWidth }}");
    expect(print).toMatch(/setLogoFit\(billLogoFit\(e\.currentTarget\.naturalWidth, e\.currentTarget\.naturalHeight\)\)/);
    expect(print).toContain("(logoFit.width / BILL_PRINT_AREA_DOTS) * 100");
  });

  it("a tenant without a logo gets no placeholder printed on the bill", () => {
    expect(print).not.toMatch(/Loading Logo/);
  });

  it("the preview shows the logo the roll prints, falling back to the branding logo", () => {
    expect(print).toMatch(/await getBillLogo\(restaurantId\)[\s\S]{0,80}\?\?\s*\(await getRestaurantLogo\(restaurantId\)/);
    expect(readSource("src/lib/db.ts")).toContain("'/restaurant/logo/bill'");
  });

  it("the header lines still carry address and GSTIN, only when set", () => {
    expect(print).toMatch(/lines\.push\(\.\.\.addressLines\(profile\?\.outlet_add\)\)/);
    expect(print).toMatch(/if \(gstin\) \{lines\.push\(`GSTN : \$\{gstin\}`\);\}/);
  });
});
