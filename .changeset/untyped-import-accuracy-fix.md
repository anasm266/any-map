---
"any-map": patch
---

Fix `untyped-import` classification so imports from local TypeScript exports that already carry `any` are not double-counted as new import sources.
