// ============================================================================
// DanteCode VS Code Extension — Package Entry Point
// Re-exports the activate and deactivate functions from the extension module
// so the package can be consumed both as a VS Code extension entry point
// (via dist/extension.js) and as a library import.
// ============================================================================

export { activate, deactivate } from "./extension";
