# kufar-watcher

Персональное desktop-приложение для мониторинга Kufar по сохранённым правилам. Проект развивается по карточкам из `docs/tasks/`; текущая работа — фундамент Electron + Nuxt.

## Требования

- Node.js 22
- npm
- Windows или Linux для целевого запуска Electron

## Команды

```bash
npm install
npm run dev          # Nuxt dev server + electron-vite main/preload watcher
npm run build        # nuxt generate + electron-vite build
npm start            # запуск собранного renderer без dev server
npm test
npm run typecheck
npm run lint
npm run format:check
```

## Архитектура bootstrap

- `electron/main/` — окно, жизненный цикл и production custom protocol.
- `electron/preload/` — пока пустой sandboxed preload; продуктовый IPC появится в `0.1.3`.
- `app/` — Nuxt 4 SPA (`ssr: false`) + Pinia.
- В production renderer обслуживается через `app://kufar/`; `file://` не используется.

Канонические ограничения и порядок работ: `docs/AGENTS.md`, `docs/ROADMAP.MD`, `docs/tasks/0-1-1-repo-toolchain.md`.
