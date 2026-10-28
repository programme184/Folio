# Mobile design tokens

`src/theme.ts` is the shared source of truth for iOS and Android UI styles.
Use `Text` and `TextInput` from `components/AppText` to retain app text scaling.

## Typography

| Role | Size / line height | Use |
| --- | --- | --- |
| `typography.caption` | 12 / 16 | Dates, metadata, compact counts |
| `typography.label` | 13 / 18 | Field labels, compact controls |
| `typography.body` | 15 / 22 | Rows, inputs, normal copy |
| `typography.title` | 17 / 24 | Screen and sheet titles |
| `typography.heading` | 20 / 28 | Major headings |

Use `fontWeight.regular` (400) for copy and dates, `medium` (500) for modest
emphasis, `semibold` (600) for row titles and controls, and `bold` (700) sparingly.
Do not introduce intermediate sizes, arbitrary line heights or per-page weights.
Keep code, terminal and measured rich-text layouts on their specialized metrics;
do not globally snap their font sizes or override inherited nested text styles.

## Colors

Always obtain colors through `usePalette()`; do not add literal colors or lower
text opacity in components. Both themes define the same semantic keys:

- `text`: primary content; `muted`: secondary text and labels.
- `subtle`: tertiary metadata on `background` or `surface`, including chat dates.
  It remains readable at normal text contrast, rather than becoming disabled text.
- `onAccent`: text/icons on filled accent controls.
- `controlSurface` and `controlBorder`: standalone outlined buttons. Use a 1pt
  outline and `radius.round` for circular home actions and the server selector.
- `border`: separators and ordinary field outlines. Keep this distinct from the
  slightly stronger control outline.
- `user`: sent-message bubble surface, soft green (`#e4f3e9`) in light mode and
  muted deep green (`#193629`) in dark mode. Keep primary and secondary text at
  readable contrast; do not substitute the stronger status `green` fill.
- Existing `blue`, `green`, `orange`, `red`, `yellow`: accent and status roles.
  Use these tokens instead of selecting new per-component hues.

Use `spacing` for the 4pt grid and `radius` for corners. Preserve minimum 44pt
touch targets. Pressed/disabled opacity applies to controls, not normal metadata.

## Adoption

The home sidebar and server-management UI use the shared typography, weight and
color tokens. A focused regression checks those files for literal text metrics,
weights and colors. Migrate other existing screens as they are edited; their
legacy inline typography has not been globally rewritten. New UI should use the
tokens from the start. Verify both themes and text wrapping after each migration.
