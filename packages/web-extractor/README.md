# @dantecode/web-extractor

Intelligent page analysis and extraction for DanteCode.

## Overview

`@dantecode/web-extractor` fetches web content through a small provider stack and returns cleaned markdown, structured metadata, source provenance, and verification warnings.

Supported providers:

- `basic-fetch` for lightweight HTTP fetches
- `crawlee` for resilient HTML crawling
- `stagehand` when a browser agent is available

## Example

```ts
import { WebExtractor } from "@dantecode/web-extractor";

const extractor = new WebExtractor({ projectRoot: process.cwd() });
const result = await extractor.fetch("https://example.com", {
  instructions: "Extract the main headline and summary",
});

console.log(result.metadata.provider);
console.log(result.markdown);
```

## Behavior

- `basic-fetch` is the default for simple HTTP requests.
- `stagehand` is preferred for browser rendering when a browser agent is available.
- `crawlee` is the deterministic fallback when browser rendering is requested but Stagehand is unavailable.
- Verification warnings are attached when browser-only behavior cannot be honored or when PDSE checks detect low-confidence output.
