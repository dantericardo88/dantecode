// ============================================================================
// @dantecode/core - Rust Tree-Sitter Parser
// Extracts function, struct, enum, trait, type, and const definitions
// ============================================================================

import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import type { SymbolDefinition } from "../repo-map-ast.js";

export class RustParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
  }

  parse(source: string, filePath: string): SymbolDefinition[] {
    const tree = this.parser.parse(source);
    const symbols: SymbolDefinition[] = [];
    const lines = source.split("\n");

    const extractSignature = (node: Parser.SyntaxNode): string => {
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      if (startLine === endLine) {
        return lines[startLine]?.trim().replace(/\s*\{?\s*$/, "") ?? "";
      }

      let signature = "";
      for (let i = startLine; i <= Math.min(endLine, startLine + 2); i++) {
        const line = lines[i]?.trim() ?? "";
        signature += line + " ";
        if (line.includes("{")) break;
      }
      return signature.trim().replace(/\s*\{?\s*$/, "");
    };

    const traverse = (node: Parser.SyntaxNode) => {
      // Function declarations
      if (node.type === "function_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "function",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Struct definitions
      if (node.type === "struct_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "class",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Enum definitions
      if (node.type === "enum_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "enum",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Trait definitions
      if (node.type === "trait_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "interface",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Type aliases
      if (node.type === "type_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "type",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Const declarations
      if (node.type === "const_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "const",
            signature: extractSignature(node),
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }

      // Recurse into children
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }
}
