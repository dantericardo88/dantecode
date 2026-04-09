# DanteCode Threat Model

## Assets
- User source code and git history
- API keys (Anthropic, GitHub tokens) in environment
- File system (read/write access during agent tasks)
- Git state (commits, branches, remotes)
- MCP server endpoints

## Threat Actors
- Malicious skill bundles (SkillBridge amber/red bucket)
- Prompt injection via user input or tool results
- Path traversal via file paths in tool calls
- Secret exfiltration via crafted tool outputs

## Threats and Mitigations

### T1: Command Injection
- **Threat**: Shell metacharacters in tool arguments execute arbitrary commands
- **Mitigation**: DanteSandbox routes all Bash via ExecutionProxy; execFileSync used throughout (not shell: true); RM_SOURCE_RE guard blocks rm -rf patterns
- **Residual risk**: `gh search` uses shell: true by design; gate.cmd is user-defined

### T2: Prompt Injection
- **Threat**: Tool results or user input manipulate agent to take unintended actions  
- **Mitigation**: PromptSanitizer (packages/core/src/prompt-sanitizer.ts) detects and logs injection patterns; tool results are quoted before injection into prompts
- **Residual risk**: LLM-level injection is a model-layer concern, not fully preventable at application layer

### T3: Path Traversal
- **Threat**: File paths containing `../` escape the project root
- **Mitigation**: DanteSandbox WorktreeIsolationLayer enforces project root boundary; paths validated before file operations
- **Residual risk**: User can configure cwd to any path they have access to

### T4: Secret Exfiltration
- **Threat**: Agent reads .env / credential files and leaks contents
- **Mitigation**: SandboxAuditLog records all file reads; TruffleHog in CI (verified-only); Gitleaks action on push/PR; memory sanitization strips secrets before storage
- **Residual risk**: In-context secrets could appear in debug-trail if not sanitized

### T5: Supply Chain (Skill Bundles)
- **Threat**: Malicious SkillBridge bundles execute arbitrary code
- **Mitigation**: BundleBucket classification (green/amber/red); red bucket blocked by default; amber requires explicit --force; sealHash verified before import

## Attack Surface
- **CLI stdin**: User prompts → PromptSanitizer → agent-loop
- **MCP server**: stdio transport (local) or HTTP/SSE (if enabled) — tool inputs validated by Zod schemas  
- **Tool results**: External data injected into context — treated as untrusted
- **Skill bundles**: Imported via SkillBridge — license + seal verified

## Security Contacts
Report security issues via GitHub Security Advisories (private disclosure).
