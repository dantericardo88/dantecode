// ============================================================================
// @dantecode/core - Python Tree-Sitter Parser
// Extracts function and class definitions from Python source
// ============================================================================

import type Parser from "tree-sitter";
import type { SymbolDefinition } from "../repo-map-ast.js";
import { OptionalNativeModuleError, loadOptionalModule } from "./native-loader.js";

type TreeSitterParserConstructor = new () => Parser;

export class PythonParser {
  private parser: Parser | null = null;

  private getParser(): Parser {
    if (this.parser) {
      return this.parser;
    }

    const ParserConstructor = loadOptionalModule<TreeSitterParserConstructor>("tree-sitter");
    const pythonLanguage = loadOptionalModule<unknown>("tree-sitter-python");

    if (!pythonLanguage) {
      throw new OptionalNativeModuleError(
        "tree-sitter-python",
        new Error("Missing Python language export"),
      );
    }

    const parser = new ParserConstructor();
    parser.setLanguage(pythonLanguage as never);
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

      // Get the definition line (before the colon)
      let signature = "";
      for (let i = startLine; i <= Math.min(endLine, startLine + 2); i++) {
        const line = lines[i]?.trim() ?? "";
        signature += line + " ";
        if (line.includes(":")) break;
      }
      return signature.trim().replace(/\s*:\s*$/, "");
    };

    const traverse = (node: Parser.SyntaxNode) => {
      // Function definitions
      if (node.type === "function_definition") {
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

      // Class definitions
      if (node.type === "class_definition") {
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

      // Recurse into children
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }
}
