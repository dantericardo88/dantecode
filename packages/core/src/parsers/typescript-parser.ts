// ============================================================================
// @dantecode/core - TypeScript/TSX Tree-Sitter Parser
// Extracts function, class, interface, type, const, and enum definitions
// ============================================================================

import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { SymbolDefinition } from "../repo-map-ast.js";

export class TypeScriptParser {
  private parser: Parser;

  constructor(isTSX = false) {
    this.parser = new Parser();
    // tree-sitter-typescript exports both typescript and tsx
    this.parser.setLanguage(isTSX ? TypeScript.tsx : TypeScript.typescript);
  }

  parse(source: string, filePath: string): SymbolDefinition[] {
    const tree = this.parser.parse(source);
    const symbols: SymbolDefinition[] = [];
    const lines = source.split("\n");

    const extractSignature = (node: Parser.SyntaxNode): string => {
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      // For single-line definitions, return the whole line
      if (startLine === endLine) {
        return lines[startLine]?.trim().replace(/\s*\{?\s*$/, "") ?? "";
      }

      // For multi-line, get declaration part (before first {)
      let signature = "";
      for (let i = startLine; i <= Math.min(endLine, startLine + 3); i++) {
        const line = lines[i]?.trim() ?? "";
        signature += line + " ";
        if (line.includes("{")) break;
      }
      return signature.trim().replace(/\s*\{?\s*$/, "");
    };

    const traverse = (node: Parser.SyntaxNode) => {
      // Function declarations
      if (node.type === "function_declaration" || node.type === "function_signature") {
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

      // Arrow functions assigned to const/let/var
      if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        const declarator = node.descendantsOfType("variable_declarator")[0];
        if (declarator) {
          const nameNode = declarator.childForFieldName("name");
          const valueNode = declarator.childForFieldName("value");
          if (
            nameNode &&
            valueNode &&
            (valueNode.type === "arrow_function" || valueNode.type === "function")
          ) {
            symbols.push({
              name: nameNode.text,
              kind: "const",
              signature: extractSignature(node),
              filePath,
              line: node.startPosition.row + 1,
            });
          } else if (nameNode && node.type === "lexical_declaration") {
            // Regular const/let declarations
            symbols.push({
              name: nameNode.text,
              kind: "const",
              signature: extractSignature(node),
              filePath,
              line: node.startPosition.row + 1,
            });
          }
        }
      }

      // Class declarations
      if (node.type === "class_declaration") {
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

      // Interface declarations
      if (node.type === "interface_declaration") {
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
      if (node.type === "type_alias_declaration") {
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

      // Enum declarations
      if (node.type === "enum_declaration") {
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

      // Recurse into children
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }
}
