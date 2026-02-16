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