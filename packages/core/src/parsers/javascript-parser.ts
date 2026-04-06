// ============================================================================
// @dantecode/core - JavaScript/JSX Tree-Sitter Parser
// Extracts function, class, and const definitions from JavaScript/JSX source
// ============================================================================

import type Parser from "tree-sitter";
import type { SymbolDefinition } from "../repo-map-ast.js";
import { OptionalNativeModuleError, loadOptionalModule } from "./native-loader.js";

type TreeSitterParserConstructor = new () => Parser;

export class JavaScriptParser {
  private parser: Parser | null = null;

  private getParser(): Parser {
    if (this.parser) {
      return this.parser;
    }

    const ParserConstructor = loadOptionalModule<TreeSitterParserConstructor>("tree-sitter");
    const javaScriptLanguage = loadOptionalModule<unknown>("tree-sitter-javascript");

    if (!javaScriptLanguage) {
      throw new OptionalNativeModuleError(
        "tree-sitter-javascript",
        new Error("Missing JavaScript language export"),
      );
    }

    const parser = new ParserConstructor();
    parser.setLanguage(javaScriptLanguage as never);
    this.parser = parser;
    return parser;
  }

  parse(source: string, filePath: string): SymbolDefinition[] {
    const tree = this.getParser().parse(source);
    const symbols: SymbolDefinition[] = [];
    const lines = source.split("\n");

    const extractSignature = (node: Parser.SyntaxNode): string => {
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      if (startLine === endLine) {
        return lines[startLine]?.trim().replace(/\s*\{?\s*$/, "") ?? "";
      }

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
      if (node.type === "function_declaration") {
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

      // Variable declarations (const, let, var)
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

      // Recurse into children
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }
}
