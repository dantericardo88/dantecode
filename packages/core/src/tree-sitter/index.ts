// packages/core/src/tree-sitter/index.ts
export { extractTagsAST, detectTreeSitterLanguage } from "./ast-symbol-extractor.js";
export type { ASTTag } from "./ast-symbol-extractor.js";
export { getParser, resetParserPool } from "./parser-pool.js";
export type { SupportedLanguage } from "./parser-pool.js";
export { SCM_QUERIES } from "./scm-queries.js";
