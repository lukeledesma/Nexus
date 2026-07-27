# Nexus Next Steps

## Immediate Next Session Priorities

1. **Stabilize import/sync extension policy**
   - Document one canonical extension policy used by:
     - organizer sync
     - finder upload
     - alchemy import
   - Ensure all paths use shared helpers/constants (no diverging extension rules).
   - Confirm whether Markdown (`.md`) should be allowed through Finder uploads (it is already accepted in disk sync).

2. **Add storage/database health diagnostics**
   - ✅ Implemented as `bin/rake nexus:storage_health`.
   - Next: optionally add an in-app read-only DB Health view powered by the same service.
   - Add threshold warnings (for example, if orphan counts exceed a configured limit).

3. **Begin modular decomposition of large units**
   - Start with one high-value target:
     - `app/javascript/controllers/content_window_controller.js`
   - Continue extracting pure utilities/helpers first (geometry, snapping math, state transforms) with no behavior changes.
   - Completed this session: shared registry + title-snap ghost helpers extracted to `lib/content_window_shared.js`.

4. **Continue service-level refactor slices**
   - `app/services/document_disk_loader.rb`: continue splitting parsing helpers from sync orchestration logic (helper extraction + orchestration + parser decomposition + scanner/purge isolation completed; next split target is optional extraction to dedicated collaborator classes if warranted).
   - `app/services/alchemy/upload_source_resolver.rb`: continue extracting datatype/code inference table objects for readability (mapping/template-load internals + code-family helpers extracted; next step is optional collaborator split for template/reference parsing).
   - `app/services/alchemy/tag_xml.rb`: continue decomposition of duplicate-address/source-format inference into narrower helpers or collaborators (mapping/helper + record builder extraction completed).
   - `app/services/storage_health_report.rb`: keep report schema stable if surfaced in UI/API.

5. **Continue frontend decomposition safely**
   - `app/javascript/controllers/content_window_controller.js`: continue extracting repeated pure helpers (storage helpers extracted this session) while preserving event contracts and UX behavior.

5. **Plan single-directory mode transition (future-safe)**
   - Design a migration path from user-rooted workspace folders to one shared main directory.
   - Keep current behavior intact until migration and compatibility strategy are explicitly approved.
   - Preserve auditability requirements (who edited/opened/closed files) separate from path ownership.

## Modules Needing Attention

- `app/javascript/controllers/content_window_controller.js` (size/complexity hotspot)
- `app/javascript/controllers/quartz_controller.js` (large behavior surface)
- `app/services/document_disk_loader.rb` (I/O and parsing complexity)
- `app/services/alchemy/upload_source_resolver.rb` (now cleaner but still large)

## Unresolved Issues

- Potential drift risk if extension handling stays split across multiple service/controller paths.
- Product-direction uncertainty around per-user directories vs one shared directory model; future refactors should be gated behind an explicit migration plan.

## Future Enhancements (Safe candidates)

- Add targeted integration tests for extension handling matrix (allowed/blocked by context).
- Introduce shared import policy object for file-type routing decisions.
- Continue constant extraction and helper decomposition in large services/controllers.
- Add performance instrumentation around expensive sync/import pathways before deeper optimizations.
