// Ambient declaration for web-tree-sitter so DTS generation succeeds when the
// package is not installed. The actual runtime import is guarded by a try/catch
// in parser-pool.ts; this file only satisfies the TypeScript compiler.
declare module "web-tree-sitter" {
  interface Node {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    children: Node[];
    childCount: number;
    namedChildren: Node[];
    namedChildCount: number;
    parent: Node | null;
    isNamed: boolean;
    hasError: boolean;
    toString(): string;
    child(index: number): Node | null;
    namedChild(index: number): Node | null;
    descendantsOfType(type: string | string[]): Node[];
    walk(): TreeCursor;
  }

  interface TreeCursor {
    nodeType: string;
    nodeText: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    currentNode: Node;
    gotoFirstChild(): boolean;
    gotoNextSibling(): boolean;
    gotoParent(): boolean;
    reset(node: Node): void;
  }

  interface Tree {
    rootNode: Node;
    edit(delta: unknown): Tree;
  }

  interface Language {
    query(source: string): Query;
  }

  interface Query {
    matches(node: Node): Array<{ pattern: number; captures: Array<{ name: string; node: Node }> }>;
    captures(node: Node): Array<{ name: string; node: Node }>;
  }

  interface InitOptions {
    locateFile?: (path: string) => string;
  }

  class Parser {
    static init(options?: InitOptions): Promise<void>;
    static Language: {
      load(path: string | Uint8Array): Promise<Language>;
    };
    setLanguage(language: Language | null): void;
    getLanguage(): Language;
    parse(input: string | ((index: number, position?: unknown) => string | null), previousTree?: Tree): Tree;
    delete(): void;
  }

  export = Parser;
}
