# Smoke Test Checklist

Run this checklist after refactor changes to ensure no behavior regressions.

1. Open app and load `data/Kobelache/data.json`.
2. Toggle map compact/expanded and verify auto-fit includes tracks + POIs + parking + overview.
3. Select section/access tracks and verify only active track is editable.
4. Insert/delete/reorder waypoints and verify marker/point list sync.
5. Switch segment mode between `straight` and `route` and verify route updates.
6. Verify keyboard point actions (`s` / `e`) still work as before.
7. Verify context-menu set/insert operations still work.
8. Edit POIs and parking lots, including drag + remove.
9. Save canyon and confirm track files + `data.json` links are written as before.
10. Reload saved canyon and confirm state matches.
11. Verify toolbar and form controls use consistent visual style and focus ring behavior.
12. Verify map overlay (compact/expanded) transitions are smooth and controls remain discoverable.
13. Verify no control is missing after restyle (tracks, insert/set, invert, clear, map controls, modals).
14. Verify active-context clarity at a glance:
    file actions, map actions, and JSON content zones are visually distinct.
15. Verify small-screen usability (`1280x800`, `1366x768`):
    controls remain reachable via vertical scroll where needed and no panel is clipped.
16. Verify large-screen readability (`1920x1080`, `2560x1440`):
    narrow semantic fields do not stretch excessively and long text remains readable.
17. Verify keyboard focus visibility and icon-button labels for destructive actions.
