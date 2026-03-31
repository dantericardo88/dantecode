// ============================================================================
// @dantecode/cli — Serve: Metrics Tests
// Tests for Prometheus metrics collection and export.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "./metrics.js";
import type { SessionRecord } from "./routes.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("recordRequest", () => {
    it("should record HTTP request metrics", () => {
      collector.recordRequest("POST", "/api/sessions", 201, 42);
      collector.recordRequest("GET", "/api/sessions/abc123", 200, 15);

      const output = collector.export(new Map());
      expect(output).toContain("http_requests_total");
      expect(output).toMatch(/http_requests_total.*method="POST".*endpoint="\/api\/sessions".*status="201".*1/);
      expect(output).toMatch(/http_requests_total.*method="GET".*endpoint="\/api\/sessions\/:id".*status="200".*1/);
    });

    it("should normalize endpoint paths", () => {
      collector.recordRequest("GET", "/api/sessions/abc-123", 200, 10);
      collector.recordRequest("GET", "/api/sessions/xyz-456", 200, 12);

      const output = collector.export(new Map());
      // Both should be aggregated under /api/sessions/:id
      expect(output).toMatch(/http_requests_total.*endpoint="\/api\/sessions\/:id".*2/);
    });

    it("should calculate response time percentiles", () => {
      // Add requests with varying durations
      for (let i = 0; i < 100; i++) {
        collector.recordRequest("GET", "/api/health", 200, i * 10);
      }

      const output = collector.export(new Map());
      expect(output).toContain("http_request_duration_seconds");
      expect(output).toMatch(/quantile="0.5"/);
      expect(output).toMatch(/quantile="0.95"/);
      expect(output).toMatch(/quantile="0.99"/);
      expect(output).toContain("http_request_duration_seconds_sum");
      expect(output).toContain("http_request_duration_seconds_count 100");
    });
  });

  describe("recordPDSE", () => {
    it("should record PDSE verification scores", () => {
      collector.recordPDSE(85);
      collector.recordPDSE(92);
      collector.recordPDSE(68);

      const output = collector.export(new Map());
      expect(output).toContain("pdse_score");
      expect(output).toContain("pdse_score_bucket");
      expect(output).toContain("pdse_score_sum");
      expect(output).toContain("pdse_score_count 3");
    });

    it("should create histogram buckets correctly", () => {
      collector.recordPDSE(55); // below 60
      collector.recordPDSE(75); // below 80
      collector.recordPDSE(95); // below 100

      const output = collector.export(new Map());
      // Each score should appear in all buckets >= its value
      expect(output).toMatch(/pdse_score_bucket\{le="60"\} 1/);
      expect(output).toMatch(/pdse_score_bucket\{le="80"\} 2/);
      expect(output).toMatch(/pdse_score_bucket\{le="100"\} 3/);
    });

    it("should ignore invalid PDSE scores", () => {
      collector.recordPDSE(-10);
      collector.recordPDSE(150);
      collector.recordPDSE(85); // valid

      const output = collector.export(new Map());
      expect(output).toContain("pdse_score_count 1");
    });
  });

  describe("recordError", () => {
    it("should record error metrics by type", () => {
      collector.recordError("client_error", "/api/sessions");
      collector.recordError("server_error", "/api/verify");
      collector.recordError("client_error", "/api/sessions");

      const output = collector.export(new Map());
      expect(output).toContain("errors_total");
      expect(output).toMatch(/errors_total.*type="client_error".*endpoint="\/api\/sessions".*2/);
      expect(output).toMatch(/errors_total.*type="server_error".*endpoint="\/api\/verify".*1/);
    });

    it("should normalize error endpoints", () => {
      collector.recordError("server_error", "/api/sessions/abc123");
      collector.recordError("server_error", "/api/sessions/xyz456");

      const output = collector.export(new Map());
      expect(output).toMatch(/errors_total.*endpoint="\/api\/sessions\/:id".*2/);
    });
  });

  describe("export", () => {
    it("should export active sessions by status", () => {
      const sessions = new Map<string, SessionRecord>([
        [
          "s1",
          {
            id: "s1",
            name: "Session 1",
            createdAt: new Date().toISOString(),
            messageCount: 5,
            model: "claude-sonnet-4-6",
            messages: [],
            status: "running",
          },
        ],
        [
          "s2",
          {
            id: "s2",
            name: "Session 2",
            createdAt: new Date().toISOString(),
            messageCount: 2,
            model: "claude-sonnet-4-6",
            messages: [],
            status: "idle",
          },
        ],
        [
          "s3",
          {
            id: "s3",
            name: "Session 3",
            createdAt: new Date().toISOString(),
            messageCount: 10,
            model: "claude-sonnet-4-6",
            messages: [],
            status: "running",
          },
        ],
      ]);

      const output = collector.export(sessions);
      expect(output).toContain("active_sessions_total");
      expect(output).toMatch(/active_sessions_total\{status="running"\} 2/);
      expect(output).toMatch(/active_sessions_total\{status="idle"\} 1/);
      expect(output).toMatch(/active_sessions_total\{status="all"\} 3/);
    });

    it("should export memory metrics", () => {
      const output = collector.export(new Map());
      expect(output).toContain("process_resident_memory_bytes");
      expect(output).toContain("process_heap_bytes");
      expect(output).toMatch(/process_heap_bytes\{type="used"\}/);
      expect(output).toMatch(/process_heap_bytes\{type="total"\}/);
    });

    it("should export CPU metrics", () => {
      const output = collector.export(new Map());
      expect(output).toContain("process_cpu_seconds_total");
      expect(output).toMatch(/process_cpu_seconds_total\{mode="user"\}/);
      expect(output).toMatch(/process_cpu_seconds_total\{mode="system"\}/);
    });

    it("should export uptime", () => {
      const output = collector.export(new Map());
      expect(output).toContain("dantecode_uptime_seconds");
      expect(output).toMatch(/dantecode_uptime_seconds \d+/);
    });

    it("should use Prometheus text format", () => {
      collector.recordRequest("GET", "/api/health", 200, 10);

      const output = collector.export(new Map());

      // Check for proper Prometheus format
      expect(output).toMatch(/# HELP .+ .+/);
      expect(output).toMatch(/# TYPE .+ (counter|gauge|histogram|summary)/);
      expect(output).toMatch(/^[a-z_][a-z0-9_]+ /m); // Metric names
      expect(output).toMatch(/\{[^}]+\}/); // Labels
    });
  });

  describe("metric retention", () => {
    it("should prune old metrics automatically", async () => {
      // Record many metrics to trigger pruning
      for (let i = 0; i < 15_000; i++) {
        collector.recordRequest("GET", "/api/health", 200, 10);
      }

      const output = collector.export(new Map());
      // Should be capped at MAX_METRICS (10,000)
      const countMatch = output.match(/http_request_duration_seconds_count (\d+)/);
      const count = countMatch ? parseInt(countMatch[1]!, 10) : 0;
      expect(count).toBeLessThanOrEqual(10_000);
    });
  });
});
