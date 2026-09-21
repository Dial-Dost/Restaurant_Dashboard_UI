# Responsive specification — CuisineFlow dashboard

The dashboard is used on a phone in an apron pocket, a foldable at the pass, an
iPad on a stand, a cheap touch monitor at the counter and a 27" screen in the
back office. This is the one place that says what each of those means in
pixels, and which rule owns each decision.

Written mobile-first: the base rules are the **smallest** screen, and every
media query is `min-width`. A rule that only ever grows the layout can be read
top to bottom without holding a stack of exceptions in your head.

## 1. Breakpoints

| Category | Range | Token | Real devices |
|---|---|---|---|
| **Small mobile** | 0 – 359px | *(base — no query)* | iPhone SE 1st gen (320), Galaxy Z Fold cover (344) |
| **Mobile** | 360 – 599px | `xs` (360px) | Pixel 8 (412), iPhone 15 (393), most Androids (360) |
| **Foldable / large phone** | 600 – 767px | `fold` (600px) | Z Fold unfolded (717), Surface Duo pane (540 → reads as mobile), phablets |
| **Tablet** | 768 – 1023px | `md` (768px) | iPad portrait (768), iPad Air (820), iPad Pro 11" (834) |
| **Laptop** | 1024 – 1279px | `lg` (1024px) | iPad landscape (1024), small laptops, counter touch monitors |
| **Desktop** | 1280 – 1399px | `xl` (1280px) | Standard monitors |
| **Large desktop** | 1400px+ | `2xl` (1400px) | Back-office screens |

`xs` and `fold` are the two added here; the rest are Tailwind's defaults, kept
because 76 source files already use them and renaming them would be a rewrite
with no user-visible gain.

In CSS use the custom media tokens documented in `globals.css`
(`--bp-xs: 360px` … `--bp-2xl: 1400px`); in components use the Tailwind
prefixes (`xs:`, `fold:`, `md:`, `lg:`, `xl:`, `2xl:`).

**Why 600 for foldables.** A Z Fold opens to 717px — wider than a phone, far
narrower than an iPad. Without a stop between 360 and 768 it inherits the phone
layout, which wastes half the screen, or the tablet layout, which crushes it.
600 is the width at which a two-column card grid stops being cramped.

## 2. Layout rules

1. **No fixed-width containers.** Widths are `%`, `rem`, `minmax()`, `fr` or
   `clamp()`. A `w-[420px]` is only allowed with a smaller value below it
   (`w-full fold:w-[420px]`), which is why the audit greps for unguarded ones.
2. **Every grid track is `minmax(0, 1fr)`.** An implicit `auto` track is sized
   by its widest child, so one wide table or one row of `whitespace-nowrap`
   buttons stretches the whole page. This is the single most common cause of
   sideways scroll in this codebase, and it caused 218px of it on Analytics at
   1280px — the original fix was scoped `max-width: 1023.98px`, and desktop kept
   the bug.
3. **Wide content scrolls inside its own box, never the page.** Tables, chart
   strips and tab rows get `overflow-x: auto` on a wrapper; `body` never
   scrolls sideways at any width.
4. **Flex rows wrap by default.** A toolbar is `flex flex-wrap gap-2`; a row
   that must stay on one line gets `overflow-x-auto` instead of `nowrap` alone.
5. **Column counts per category:** cards 1 → 2 (`fold`) → 3 (`md`) → 4 (`xl`);
   the sidebar is a drawer below `lg` and permanent from `lg` up.

## 3. Fluid typography

Type scales with the viewport between 320px and 1440px via `clamp()`, so there
is no jump at a breakpoint and no 11px text on a 320px screen:

| Token | Min (320px) | Max (1440px) | Use |
|---|---|---|---|
| `--fs-xs` | 12px | 13px | Timestamps, table meta — **never below 12px** |
| `--fs-sm` | 13px | 14px | Secondary text, table cells |
| `--fs-base` | 15px | 16px | Body |
| `--fs-lg` | 17px | 19px | Card titles |
| `--fs-xl` | 20px | 24px | Section headings |
| `--fs-2xl` | 24px | 32px | Page titles |
| `--fs-money` | 28px | 40px | Headline figures (Today's takings, table totals) |

**12px is the floor.** Below that, figures on a counter monitor at arm's length
stop being readable, and iOS zooms any focused field under 16px — which is why
form controls are pinned to 16px below `sm` (already in `globals.css`).

## 4. Touch targets

Under `@media (pointer: coarse)` every interactive element gets **44 × 44px**
minimum (WCAG 2.5.5 AA is 24px; 44 is Apple's guidance and what a fingertip
actually needs on a wet counter). Icon-only buttons get 44px square. Rows in a
list are 48px tall. Spacing between adjacent targets is at least 8px.

This is applied centrally in `globals.css` rather than per component, so a new
button is correct by default. Fine pointers (mouse) keep the denser sizing,
because a 44px row limit would cost a manager three visible rows per screen.

## 5. Viewport and safe areas

```
width=device-width, initial-scale=1, viewport-fit=cover
```

`viewport-fit=cover` lets the page paint under the notch and the home bar; the
shell then pads itself back out with `env(safe-area-inset-*)`. **No
`maximum-scale` and no `user-scalable=no`** — pinch-zoom is how a partially
sighted cashier reads a total, and blocking it is an accessibility failure.

## 6. Foldables

- The 600–767px band exists so an unfolded phone gets its own layout.
- `@media (horizontal-viewport-segments: 2)` keeps content out of the hinge on
  dual-screen devices by giving the shell a hinge-width gap.
- Nothing is positioned by absolute pixel offsets from the right edge, which is
  what breaks when a device changes width mid-session as it folds.

## 7. How to check a change

```sh
node scripts/responsive-audit.js            # 10 widths x 6 pages
```

It fails on: any sideways page scroll, any element past the right edge outside
a scroller, any coarse-pointer target under 44px, and any text under 12px.
