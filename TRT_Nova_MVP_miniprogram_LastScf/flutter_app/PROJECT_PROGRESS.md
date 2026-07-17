# TRT Nova Flutter App Progress

Last updated: 2026-05-25

## Current status

- Flutter app scaffold created in `flutter_app/`
- Main shell and core pages are in place:
  - Login
  - Home
  - Assistant
  - Plant Library
  - Profile
  - Device Detail
  - Device Settings
  - Plant Journal
- Mock data and local assets are wired up
- Initial smoke test passes with `flutter test`

## What is already implemented

- 4-tab bottom navigation
- Demo login flow
- Device switching and device detail entry
- Plant journal entry flow
- Plant library browsing
- Assistant chat UI shell
- Shared theme and reusable widgets
- Default plant image asset

## Semantic rules already aligned

- `personality` is shown as a top-level plant/device tag
- `favorability` is shown normally when the plant is alive
- when `isDead == true`, the visible state switches to death-related presentation
- `irStatus` is used to derive the soul/ghost state
- `plant journal` is for manual events and todo-driven records, not sensor history duplication

## Backend direction

- Short term: keep using existing SCF JavaScript backend
- Long term: we can decide later whether to keep SCF JS or migrate core services to FastAPI

## Next steps

1. Connect Flutter app to the existing backend APIs
2. Replace remaining mock data with real API data
3. Polish device detail sensor switching and trend display
4. Wire assistant chat to backend responses
5. Add real auth token handling and session persistence

## Notes

- The current Flutter app is intentionally conservative: it mirrors the existing mini program flow instead of redesigning the product.
- Visual style is still adjustable later; functionality comes first for this phase.
