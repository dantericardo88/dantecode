// ============================================================================
// @dantecode/core - Go Tree-Sitter Parser
// Extracts function, type, interface, and struct definitions from Go source
// ============================================================================

import type Parser from "tree-sitter";
import type { SymbolDefinition } from "../repo-map-ast.js";
import { OptionalNativeModuleError, loadOptionalModule } from "./native-loader.js";

type TreeSitterParserConstructor = new () => Parser;

export class GoParser {
  private parser: Parser | null = null;

  private getParser(): Parser {
    if (this.parser) {
      return this.parser;
    }

    const ParserConstructor = loadOptionalModule<TreeSitterParserConstructor>("tree-sitter");
    const goLanguage = loadOptionalModule<unknown>("tree-sitter-go");

    if (!goLanguage) {
      throw new OptionalNativeModuleError(
        "tree-sitter-go",
        new Error("Missing Go language export"),
      );
    }

    const parser = new ParserConstructor();
    parser.setLanguage(goLanguage as never);
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
      for (let i = startLine; i <= Math.min(endLine, startLine + 2); i++) {
        const line = lines[i]?.trim() ?? "";
        signature += line + " ";
        if (line.includes("{")) break;
      }
      return signature.trim().replace(/\s*\{?\s*$/, "");
    };

    const traverse = (node: Parser.SyntaxNode) => {
      // Function declarations
      if (node.type === "function_declaration" || node.type === "method_declaration") {
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

      // Type declarations (includes structs and interfaces)
      if (node.type === "type_declaration") {
        const spec = node.childForFieldName("type_spec") ?? node.descendantsOfType("type_spec")[0];
        if (spec) {
          const nameNode = spec.childForFieldName("name");
          const typeNode = spec.childForFieldName("type");
          if (nameNode && typeNode) {
            let kind: SymbolDefinition["kind"] = "type";
            if (typeNode.type === "interface_type") {
              kind = "interface";
            } else if (typeNode.type === "struct_type") {
              kind = "class"; // Map Go struct to class kind
            }
            symbols.push({
              name: nameNode.text,
              kind,
              signature: extractSignature(node),
              filePath,
              line: node.startPosition.row + 1,
            });
          }
        }
      }

      // Const declarations
      if (node.type === "const_declaration") {
        const specs = node.descendantsOfType("const_spec");
        for (const spec of specs) {
          const nameNode = spec.childForFieldName("name");
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              kind: "const",
              signature: extractSignature(spec),
              filePath,
              line: spec.startPosition.row + 1,
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
