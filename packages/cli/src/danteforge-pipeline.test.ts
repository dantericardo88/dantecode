import { describe, it, expect, vi } from "vitest";

// Mock the compiled @dantecode/danteforge binary before importing the pipeline module
vi.mock("@dantecode/danteforge", () => ({
  runAntiStubScanner: vi.fn(),
  runLocalPDSEScorer: vi.fn(),
  runConstitutionCheck: vi.fn(),
}));

import { getAllWrittenFilePath, getWrittenFilePath } from "./danteforge-pipeline.js";

describe("getAllWrittenFilePath", () => {
  it("returns path for Write tool with any extension", () => {
    expect(getAllWrittenFilePath("Write", { file_path: "package.json" })).toBe("package.json");
    expect(getAllWrittenFilePath("Write", { file_path: "config.yaml" })).toBe("config.yaml");
    expect(getAllWrittenFilePath("Write", { file_path: "README.md" })).toBe("README.md");
    expect(getAllWrittenFilePath("Write", { file_path: "style.css" })).toBe("style.css");
    expect(getAllWrittenFilePath("Write", { file_path: "index.html" })).toBe("index.html");
  });

  it("returns path for Edit tool with any extension", () => {
    expect(getAllWrittenFilePath("Edit", { file_path: "tsconfig.json" })).toBe("tsconfig.json");
    expect(getAllWrittenFilePath("Edit", { file_path: "app.ts" })).toBe("app.ts");
  });

  it("returns null for non-write tools", () => {
    expect(getAllWrittenFilePath("Read", { file_path: "file.ts" })).toBeNull();
    expect(getAllWrittenFilePath("Bash", { command: "ls" })).toBeNull();
    expect(getAllWrittenFilePath("Glob", { pattern: "*.ts" })).toBeNull();
  });

  it("returns null when file_path is missing", () => {
    expect(getAllWrittenFilePath("Write", {})).toBeNull();
    expect(getAllWrittenFilePath("Edit", { content: "test" })).toBeNull();
  });
});

describe("getWrittenFilePath vs getAllWrittenFilePath", () => {
  it("getWrittenFilePath rejects non-code extensions that getAllWrittenFilePath accepts", () => {
    const configFiles = [
      "package.json",
      "config.yaml",
      "README.md",
      "style.css",
      "index.html",
      ".prettierrc",
    ];
    for (const file of configFiles) {
      // getWrittenFilePath filters out non-code files
      expect(getWrittenFilePath("Write", { file_path: file })).toBeNull();
      // getAllWrittenFilePath accepts all file extensions
      expect(getAllWrittenFilePath("Write", { file_path: file })).toBe(file);
    }
  });

  it("both return path for code files", () => {
    const codeFiles = ["app.ts", "index.js", "main.py", "lib.rs", "server.go"];
    for (const file of codeFiles) {
      expect(getWrittenFilePath("Write", { file_path: file })).toBe(file);
      expect(getAllWrittenFilePath("Write", { file_path: file })).toBe(file);
    }
  });

  it("both return null for non-write tools", () => {
    expect(getWrittenFilePath("Read", { file_path: "app.ts" })).toBeNull();
    expect(getAllWrittenFilePath("Read", { file_path: "app.ts" })).toBeNull();
  });
});
