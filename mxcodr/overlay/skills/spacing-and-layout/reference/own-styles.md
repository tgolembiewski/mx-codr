# The app's own styles (skill spacing-and-layout)

The look of the app (the theme, or in Studio Pro the person's Look tab: colour, corners, font, light or dark)
reaches only what reads the theme's variables. A rule of your own with a fixed value beats Atlas's rule as soon
as its selector is more specific, so no later look changes it. Measured on a test app:
`.region-content .btn { border-radius: 8px }` kept every button at 8px through round corners and then the stock
corners, with two restarts in between.

## Three steps, best first

1. **What Atlas gives.** Classes (`btn-primary`, `card`, `text-muted`, `background-secondary`, ...) and Studio
   Pro's design properties (`Spacing`, `Background color`, `Shadow`, `Border`, `Align`, ...). Use them whenever
   they are enough. They follow every look and need no SCSS at all.
2. **Own SCSS from theme variables.** Only where step 1 is not enough. Every colour, corner, font, spacing and
   shadow comes from a variable, never from a fixed value:

   | What | Use | Not |
   |---|---|---|
   | brand, accents | `var(--brand-primary)`, `var(--brand-success)`, `var(--brand-danger)`, `var(--brand-warning)` | `#2f6fed` |
   | surfaces | `var(--bg-color)`, `var(--bg-color-secondary)` | `#fff`, `#f6f8fb` |
   | text | `var(--font-color-default)`, `var(--font-color-detail)` | `#1f2937` |
   | lines | `var(--border-color-default)` | `#e8ecf1` |
   | corners | `var(--btn-border-radius)` on buttons, `var(--border-radius-default)`, `var(--border-radius-l)` on panels, `var(--form-input-border-radius)` on inputs | `8px`, `12px` |
   | font | `var(--font-family-base)` | `Inter, sans-serif` |
   | spacing | `var(--spacing-small)`, `var(--spacing-medium)`, `var(--spacing-large)` | `14px 18px` |
   | shadows | `var(--shadow-small)`, `var(--shadow-medium)`, `var(--shadow-large)` | `0 8px 30px rgba(...)` |

   These are Atlas's own variables: plain Atlas defines them and every look of mx-codr sets them, so they never
   go blank. The `--mxt-*` tokens (`var(--mxt-brand)`) follow a look too but are gone once the app is back on
   plain Atlas; give them a fallback (`var(--mxt-brand, var(--brand-primary))`). A tint of a variable:
   `color-mix(in srgb, var(--brand-primary) 12%, transparent)`, never `rgba(<hex>, 0.12)`.
3. **One file per module, a reason per rule.** All of a module's own SCSS in one file,
   `themesource/<module>/web/main.scss`, and a short comment over each rule saying why Atlas was not enough:

   ```scss
   // A board row: Atlas has no class for a highlighted list row with an accent edge.
   .mm-row-active {
     background: color-mix(in srgb, var(--brand-primary) 6%, transparent);
     border-left: 3px solid var(--brand-primary);
     border-radius: var(--border-radius-default);
   }
   ```

## Allowed fixed values

What no look governs may stay fixed:

- circles and pills: `border-radius: 50%`, `999px` (a peg, an avatar, a badge); `0` (no corners);
- colours that carry meaning: a game's peg colours, a chart's series, a traffic light. Mark them on the line,
  or once on the rule, so the check knows they are meant:

  ```scss
  .mm-c1 { background: #ef5b5b; border-color: #ef5b5b; } /* mxcodr: keep - peg colour, part of the game */
  /* mxcodr: keep - confetti colours */
  .mm-cf1 { background: #f5a623; }
  ```

  `mxcodr: keep` in a comment on the declaration's line, on the rule's opening line, or on the line above it;
- icons and images (`url(...)`, an SVG's own fills).

## Checking

In Studio Pro (live mode) `./mxcodr-live styles` lists every fixed colour, corner and font left in the app's own
SCSS, with file:line and the variable to use; the turn's card and the Look tab say the same. They only warn and
never block: replace the values, or mark the meaningful ones with `mxcodr: keep`. Marketplace modules (Atlas,
Data Widgets, Web Actions, ...) and the theme's generated files are never counted.
