# LibreChat theme extension

`client/src/components/Hermes/librechatTheme.json` in the LibreChat source is a
native Hermes user theme. It extends the existing component styles through theme
tokens and a CSS overlay; it does not replace the dashboard or its components.
Deployment mounts it read-only as `/opt/data/dashboard-themes/librechat.yaml`.
Select **LibreChat** from Hermes' theme picker to use it on the standalone dashboard.

The embedded workspace adds the same CSS after iframe load and maps LibreChat's
live color tokens and font to it. A host theme change updates the iframe without
reloading its form or session. Existing Hermes stylesheets, markup, handlers,
status colors and code/terminal fonts remain intact. Observer/style resources are
removed on navigation or unmount. Native Hermes theme choices are still available.

The overlay uses neutral surfaces, normal text spacing, sans-serif UI labels,
rounded controls/cards, visible keyboard focus, and existing responsive layouts.
Only existing same-origin Inter font declarations are reused; it adds no external
font dependency.
