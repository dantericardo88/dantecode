# @dantecode/web-extractor

**⚠️ EXPERIMENTAL - Wave 6 (Out-of-Ship Scope)**

This package is currently in experimental phase and is excluded from release readiness checks. It contains production-grade web extraction capabilities but may undergo significant changes.

## Overview

Intelligent page analysis and extraction engine for DanteCode, providing:

- Multi-provider web scraping (Crawl4AI, Stagehand, basic fetch)
- Content cleaning and deduplication
- Relevance scoring and injection detection
- PDSE verification bridge for content quality assessment

## Features

- **Provenance tracking** - Traceable source URLs
- **Depth analysis** - Content length validation
- **Specificity checks** - Title presence and stub detection
- **Evidence integrity** - Structured data validation

## API

```typescript
import { WebExtractor } from "@dantecode/web-extractor";

const extractor = new WebExtractor();
const result = await extractor.fetch("https://example.com");
```

## Status

This package is under active development. APIs may change and features may be unstable.</content>
<parameter name="filePath">C:\Projects\DanteCode\packages\web-extractor\README.md
