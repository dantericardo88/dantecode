# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in DanteCode, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, email: **security@dantecode.dev**

Include:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 7 days
- **Fix release**: Within 30 days for critical issues

## Security Measures

DanteCode includes built-in security gates:

- **Constitution Checker** — Blocks hardcoded secrets, credential exposure, dangerous operations (rm -rf, DROP TABLE), code injection (eval, innerHTML), and prototype pollution.
- **Anti-Stub Scanner** — Prevents placeholder code from reaching production.
- **Sandbox Isolation** — Docker container execution with restricted network, memory limits, and read-only filesystem.
- **Audit Logging** — All model interactions and tool calls logged to JSONL for traceability.

## Scope

The following are in scope for security reports:

- Credential leakage through model prompts or responses
- Sandbox escape or container breakout
- Command injection via user input
- Unauthorized file system access
- Dependency vulnerabilities in production packages

## Out of Scope

- Vulnerabilities in third-party AI model APIs
- Issues requiring physical access to the machine
- Social engineering attacks
