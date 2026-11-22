Glint — local macOS prototype

To run from source:
  npm install
  npm start

To package a macOS app:
  npm run pack

The app bundle is generated at dist/mac-arm64/Glint.app. It is an unsigned local prototype, so on first open macOS may require right-click > Open and a confirmation.

Features currently implemented: folder/file open, recursive explorer, tabs, editable text area, save/save-as, line numbers, lightweight syntax highlighting, command palette (Shift+Cmd+P), find/replace (Cmd+F / Shift+Cmd+F), sidebar toggle (Cmd+B), custom themes/colours and editor settings, external file change notifications, and window controls.
