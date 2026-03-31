# DanteCode Production Deployment Guide

This guide covers deploying DanteCode in production environments using Docker, Kubernetes, and bare metal installations.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Bare Metal Installation](#bare-metal-installation)
  - [Docker Deployment](#docker-deployment)
  - [Kubernetes Deployment](#kubernetes-deployment)
- [Environment Variables](#environment-variables)
- [Health Checks & Monitoring](#health-checks--monitoring)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Performance Tuning](#performance-tuning)

---

## Prerequisites

### Required Software

- **Node.js** 20.x or higher ([download](https://nodejs.org))
- **Git** 2.x or higher
- **npm** 11.x or higher (included with Node.js)

### Optional Software

- **Docker** 24.x or higher (for containerized deployment)
- **Kubernetes** 1.27+ (for orchestrated deployment)
- **Ollama** (for local LLM inference without API keys)

### Required API Keys

At least one AI provider API key is required:

| Provider | Environment Variable | Get Key From |
|----------|---------------------|--------------|
| **Anthropic** (recommended) | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| **X.AI (Grok)** | `XAI_API_KEY` or `GROK_API_KEY` | [x.ai](https://x.ai) |
| **OpenAI** | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| **Google** | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | [ai.google.dev](https://ai.google.dev) |
| **Groq** | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| **Ollama** | None (runs locally) | [ollama.com](https://ollama.com) |

### Optional API Keys

For enhanced features:

- **GitHub Token** (`GITHUB_TOKEN` or `GH_TOKEN`) - Required for `/review`, `/triage`, and automation features
- **Slack** (`SLACK_SIGNING_SECRET`) - For Slack integration
- **GitLab** (`GITLAB_WEBHOOK_SECRET`) - For GitLab webhooks

---

## Installation Methods

### Bare Metal Installation

#### 1. Clone and Build

```bash
# Clone repository
git clone https://github.com/dantericardo88/dantecode.git
cd dantecode

# Install dependencies
npm ci

# Build all packages
npm run build

# Verify build
npm run typecheck
npm test
```

#### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your API keys
nano .env
```

Required minimum configuration:

```bash
# At least one AI provider
ANTHROPIC_API_KEY=sk-ant-api03-...

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

#### 3. Initialize Project

```bash
# Initialize DanteCode configuration
npm run cli init

# Verify installation
npm run cli -- /status
```

#### 4. Run as Service (systemd)

Create `/etc/systemd/system/dantecode.service`:

```ini
[Unit]
Description=DanteCode API Server
After=network.target

[Service]
Type=simple
User=dantecode
WorkingDirectory=/opt/dantecode
Environment="NODE_ENV=production"
EnvironmentFile=/opt/dantecode/.env
ExecStart=/usr/bin/node /opt/dantecode/packages/cli/dist/index.js serve --port 3000
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/dantecode/data /opt/dantecode/.dantecode

[Install]
WantedBy=multi-user.target
```

Start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable dantecode
sudo systemctl start dantecode
sudo systemctl status dantecode
```

---

### Docker Deployment

#### Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
nano .env  # Add your API keys

# 2. Start stack
docker-compose up -d

# 3. Verify health
curl http://localhost:3000/api/health

# 4. View logs
docker-compose logs -f dantecode
```

#### Build Custom Image

```bash
# Build image
docker build -t dantecode:latest .

# Test locally
docker run -d \
  --name dantecode \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.dantecode:/app/.dantecode \
  dantecode:latest

# Check health
docker exec dantecode node -e "fetch('http://localhost:3000/api/health').then(r => console.log(r.status))"
```

#### Docker Compose Production Setup

The provided `docker-compose.yml` includes:

- **DanteCode API server** with automatic restarts
- **Ollama** service for local LLM inference
- **Persistent volumes** for data, configuration, and workspace
- **Health checks** with automatic container restart
- **Network isolation** with bridge networking

Key volumes:

```yaml
volumes:
  - dantecode-data:/app/data          # Session data and artifacts
  - dantecode-config:/app/.dantecode  # Configuration and state
  - ./workspace:/workspace            # Your project files
```

#### Production Considerations

1. **Secrets Management**: Use Docker secrets or external secret management
   ```bash
   echo "sk-ant-api03-..." | docker secret create anthropic_key -
   ```

2. **Resource Limits**: Add to `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 4G
       reservations:
         cpus: '1'
         memory: 2G
   ```

3. **Logging**: Configure log driver:
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

---

### Kubernetes Deployment

#### Prerequisites

- Kubernetes cluster (1.27+)
- `kubectl` configured
- Container registry access
- Persistent storage provisioner

#### Quick Deploy

```bash
# 1. Build and push image
docker build -t your-registry/dantecode:v0.9.2 .
docker push your-registry/dantecode:v0.9.2

# 2. Create namespace
kubectl create namespace dantecode

# 3. Create secrets (DO NOT use secrets.yaml template in production)
kubectl create secret generic dantecode-secrets \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-api03-... \
  --from-literal=OPENAI_API_KEY=sk-proj-... \
  --from-literal=GITHUB_TOKEN=ghp_... \
  --from-literal=DANTECODE_API_TOKEN=$(openssl rand -hex 32) \
  --namespace=dantecode

# 4. Apply manifests
kubectl apply -f k8s/deployment.yaml -n dantecode
kubectl apply -f k8s/service.yaml -n dantecode

# 5. Verify deployment
kubectl get pods -n dantecode
kubectl logs -f deployment/dantecode -n dantecode
```

#### Health Check Configuration

The deployment includes three types of probes:

1. **Liveness Probe** - Restarts container if unhealthy
   ```yaml
   livenessProbe:
     httpGet:
       path: /api/health
       port: 3000
     initialDelaySeconds: 30
     periodSeconds: 30
     failureThreshold: 3
   ```

2. **Readiness Probe** - Removes from service if not ready
   ```yaml
   readinessProbe:
     httpGet:
       path: /api/ready
       port: 3000
     initialDelaySeconds: 10
     periodSeconds: 10
     failureThreshold: 3
   ```

3. **Startup Probe** - Allows longer startup time
   ```yaml
   startupProbe:
     httpGet:
       path: /api/health
       port: 3000
     initialDelaySeconds: 5
     periodSeconds: 10
     failureThreshold: 12  # 120 seconds total
   ```

#### Scaling

```bash
# Horizontal scaling
kubectl scale deployment dantecode --replicas=5 -n dantecode

# Autoscaling (HPA)
kubectl autoscale deployment dantecode \
  --cpu-percent=70 \
  --min=2 \
  --max=10 \
  -n dantecode
```

#### Exposing Externally

```bash
# Option 1: NodePort
kubectl patch svc dantecode -n dantecode -p '{"spec": {"type": "NodePort"}}'

# Option 2: LoadBalancer (cloud providers)
kubectl patch svc dantecode -n dantecode -p '{"spec": {"type": "LoadBalancer"}}'

# Option 3: Ingress (recommended)
# Edit k8s/service.yaml and apply
kubectl apply -f k8s/service.yaml -n dantecode
```

#### Monitoring

```bash
# View logs
kubectl logs -f deployment/dantecode -n dantecode

# Check resource usage
kubectl top pods -n dantecode

# Describe deployment
kubectl describe deployment dantecode -n dantecode

# Events
kubectl get events --sort-by='.lastTimestamp' -n dantecode
```

---

## Environment Variables

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Node.js environment mode |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `DANTECODE_API_TOKEN` | No | None | API authentication token for HTTP server |
| `PROJECT_ROOT` | No | `./workspace` | Project workspace directory |

### AI Provider Keys

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | One of these | None | Anthropic API key (Claude models) |
| `OPENAI_API_KEY` | One of these | None | OpenAI API key (GPT models) |
| `XAI_API_KEY` | One of these | None | X.AI API key (Grok models) |
| `GROK_API_KEY` | One of these | None | Alternative for X.AI |
| `GOOGLE_API_KEY` | One of these | None | Google API key (Gemini models) |
| `GEMINI_API_KEY` | One of these | None | Alternative for Google |
| `GROQ_API_KEY` | One of these | None | Groq API key (fast inference) |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama endpoint for local models |

### GitHub Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | No | None | GitHub personal access token |
| `GH_TOKEN` | No | None | Alternative for `GITHUB_TOKEN` |
| `GITHUB_WEBHOOK_SECRET` | No | None | Secret for validating GitHub webhooks |
| `GITHUB_REPOSITORY` | No | None | Default repository (format: `owner/repo`) |

### Model Adaptation

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DANTE_MODEL_ADAPTATION_MODE` | No | `observe-only` | Adaptation mode: `observe-only`, `staged`, `auto` |
| `DANTE_DISABLE_MODEL_ADAPTATION` | No | `0` | Disable model adaptation (1 = disabled) |
| `DANTE_ADAPTATION_ROLLBACK_CHECK_INTERVAL` | No | `10` | Rollback check interval (seconds) |

### Advanced Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DANTECODE_DEBUG` | No | `0` | Enable verbose debug logging (1 = enabled) |
| `DANTECODE_EXPORT_TELEMETRY` | No | `0` | Export telemetry data (1 = enabled) |
| `SLACK_SIGNING_SECRET` | No | None | Slack webhook validation secret |
| `GITLAB_WEBHOOK_SECRET` | No | None | GitLab webhook validation secret |
| `CUSTOM_WEBHOOK_SECRET` | No | None | Custom webhook validation secret |

### PDSE Verification

PDSE (Post-Delivery Score Engine) thresholds are configured in `.dantecode/STATE.yaml`:

```yaml
pdse:
  threshold: 85  # Minimum acceptance score (0-100)
  enabled: true
```

CLI override:

```bash
dantecode config set pdse.threshold 90
```

### Complete Example

```bash
# Minimum configuration (Anthropic)
ANTHROPIC_API_KEY=sk-ant-api03-...
LOG_LEVEL=info
NODE_ENV=production

# Multi-provider with GitHub
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
GITHUB_TOKEN=ghp_...
DANTECODE_API_TOKEN=$(openssl rand -hex 32)
LOG_LEVEL=info
DANTE_MODEL_ADAPTATION_MODE=staged

# Full production stack
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
XAI_API_KEY=xai-...
GOOGLE_API_KEY=...
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=webhook-secret-here
DANTECODE_API_TOKEN=$(openssl rand -hex 32)
LOG_LEVEL=info
NODE_ENV=production
DANTE_MODEL_ADAPTATION_MODE=auto
DANTECODE_EXPORT_TELEMETRY=1
```

---

## Health Checks & Monitoring

### Health Endpoints

#### `/api/health` - Liveness Check

Returns detailed system health:

```bash
curl http://localhost:3000/api/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00.000Z",
  "version": "0.9.2",
  "uptime": 3600,
  "checks": {
    "memory": {
      "heapUsed": 150,
      "heapTotal": 200,
      "rss": 250,
      "unit": "MB"
    },
    "apiKeys": "configured",
    "sessions": {
      "active": 3,
      "limit": 100
    }
  }
}
```

Status codes:
- `200` - System healthy
- `503` - System degraded (still returns JSON)

#### `/api/ready` - Readiness Check

Returns simple readiness status for load balancers:

```bash
curl http://localhost:3000/api/ready
```

Response (ready):

```json
{
  "ready": true,
  "timestamp": "2026-03-30T12:00:00.000Z"
}
```

Response (not ready):

```json
{
  "ready": false,
  "timestamp": "2026-03-30T12:00:00.000Z",
  "reason": "No API keys configured"
}
```

Status codes:
- `200` - Ready to accept traffic
- `503` - Not ready (no API keys, session limit reached)

### Startup Health Check

Run manual startup check:

```bash
# Via CLI
npm run cli -- /status

# Via Node.js
node packages/cli/dist/index.js /status
```

Checks:
- ✅ Node.js version >= 18
- ✅ `.dantecode/` directory exists/created
- ✅ At least one provider API key configured
- ✅ DanteForge binary loadable

### Monitoring Best Practices

#### 1. Prometheus Integration

Add to Kubernetes deployment annotations:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "3000"
  prometheus.io/path: "/api/health"
```

#### 2. Log Aggregation

Configure structured logging:

```bash
LOG_LEVEL=info
NODE_ENV=production
```

Logs include:
- Session lifecycle events
- Tool execution traces
- PDSE verification results
- Error stack traces

#### 3. Alerting Rules

Recommended alerts:

```yaml
# High memory usage
- alert: DanteCodeHighMemory
  expr: container_memory_usage_bytes{pod=~"dantecode.*"} > 1.5e9
  for: 5m

# Health check failing
- alert: DanteCodeUnhealthy
  expr: up{job="dantecode"} == 0
  for: 2m

# Session limit reached
- alert: DanteCodeSessionLimit
  expr: dantecode_active_sessions >= dantecode_session_limit
  for: 1m
```

#### 4. Performance Metrics

Key metrics to track:

- **Response time**: API endpoint latency
- **Token usage**: LLM token consumption
- **PDSE scores**: Verification quality trends
- **Session duration**: Average agent loop time
- **Error rate**: Failed tool executions

### Troubleshooting Command

Run built-in diagnostics:

```bash
# Check system status
dantecode /troubleshoot

# View recent logs
dantecode /logs --lines 100

# Check active sessions
dantecode /sessions

# Verify configuration
dantecode config list
```

---

## Security

### Secret Management

#### DO NOT commit secrets to git

```bash
# Add to .gitignore
echo ".env" >> .gitignore
echo ".dantecode/secrets/" >> .gitignore
```

#### Production Secret Storage

**Option 1: Environment Variables** (simplest)

```bash
export ANTHROPIC_API_KEY=$(vault kv get -field=key secret/dantecode/anthropic)
```

**Option 2: Docker Secrets**

```bash
echo "sk-ant-api03-..." | docker secret create anthropic_key -
```

**Option 3: Kubernetes Secrets**

```bash
kubectl create secret generic dantecode-secrets \
  --from-literal=ANTHROPIC_API_KEY=$(vault ...) \
  --namespace=dantecode
```

**Option 4: External Secret Operators**

- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
- [External Secrets Operator](https://external-secrets.io/)
- [AWS Secrets Manager CSI Driver](https://github.com/aws/secrets-store-csi-driver-provider-aws)
- [HashiCorp Vault](https://www.vaultproject.io/)

### Network Security

#### 1. Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow 3000/tcp  # DanteCode API
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
```

#### 2. TLS/HTTPS

Use reverse proxy (nginx, Traefik, or Kubernetes Ingress):

```nginx
server {
    listen 443 ssl http2;
    server_name dantecode.example.com;

    ssl_certificate /etc/letsencrypt/live/dantecode.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dantecode.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 3. API Authentication

Protect HTTP API with token:

```bash
# Generate secure token
export DANTECODE_API_TOKEN=$(openssl rand -hex 32)

# Add to requests
curl -H "Authorization: Bearer $DANTECODE_API_TOKEN" \
  http://localhost:3000/api/sessions
```

#### 4. Sandbox Isolation

DanteCode includes mandatory sandboxing via `@dantecode/dante-sandbox`:

- **Docker isolation** - Tool execution in containers
- **Worktree isolation** - Git worktrees for parallel agents
- **Host escape prevention** - Blocks escape attempts

Configure in `.dantecode/STATE.yaml`:

```yaml
sandbox:
  enabled: true
  dockerImage: "node:20-alpine"
  allowHostEscape: false  # NEVER set to true in production
```

### Rate Limiting

Implement rate limiting at proxy level:

```nginx
# nginx rate limiting
limit_req_zone $binary_remote_addr zone=dantecode:10m rate=10r/s;

location / {
    limit_req zone=dantecode burst=20 nodelay;
    proxy_pass http://localhost:3000;
}
```

### Security Hardening Checklist

- [ ] Secrets stored securely (not in git)
- [ ] TLS/HTTPS enabled for external access
- [ ] API authentication token configured
- [ ] Firewall rules configured
- [ ] Running as non-root user
- [ ] Sandbox enabled and tested
- [ ] Rate limiting implemented
- [ ] Log aggregation configured
- [ ] Security updates automated
- [ ] Backup strategy implemented

---

## Troubleshooting

### Common Issues

#### 1. "No API keys configured"

**Symptom**: Health check fails with missing API keys

**Solution**:

```bash
# Check environment
echo $ANTHROPIC_API_KEY

# If empty, set it
export ANTHROPIC_API_KEY=sk-ant-...

# Verify in app
curl http://localhost:3000/api/health | jq '.checks.apiKeys'
```

#### 2. Build Failures

**Symptom**: `npm run build` fails with TypeScript errors

**Solution**:

```bash
# Clean and rebuild
npm run clean
rm -rf node_modules package-lock.json
npm ci
npm run build

# Verify workspace links
npm run typecheck
```

#### 3. Docker Container Crashes

**Symptom**: Container exits immediately after start

**Solution**:

```bash
# Check logs
docker logs dantecode

# Common causes:
# - Missing API keys: Add to .env or pass via -e
# - Memory limit: Increase Docker memory limit
# - Port conflict: Change port mapping

# Debug interactively
docker run -it --entrypoint /bin/sh dantecode:latest
```

#### 4. High Memory Usage

**Symptom**: Memory usage > 2GB, OOM kills

**Solution**:

```bash
# Check memory
curl http://localhost:3000/api/health | jq '.checks.memory'

# Reduce session limit in STATE.yaml
dantecode config set sessions.maxActive 50

# Compact context more aggressively
dantecode /compact
```

#### 5. Kubernetes Pod Not Ready

**Symptom**: Pod stuck in `0/1 Ready` state

**Solution**:

```bash
# Check readiness probe
kubectl describe pod dantecode-xxx -n dantecode

# View logs
kubectl logs dantecode-xxx -n dantecode

# Common causes:
# - Init container failure (missing API keys)
# - Health endpoint not responding (port misconfigured)
# - PVC mount failure (storage not provisioned)
```

#### 6. "/review command not working"

**Symptom**: GitHub operations fail with authentication error

**Solution**:

```bash
# Verify GitHub token
echo $GITHUB_TOKEN

# Test token manually
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/user

# Ensure token has correct scopes:
# - repo (full control)
# - read:org (organization access)
```

### Debug Mode

Enable verbose logging:

```bash
# Environment variable
export DANTECODE_DEBUG=1

# Or in .env
DANTECODE_DEBUG=1
LOG_LEVEL=debug

# Restart service
sudo systemctl restart dantecode
```

### Log Locations

**Bare metal**:
- Application logs: `stdout` (systemd journal)
- Audit trail: `.dantecode/audit-log.jsonl`
- Session data: `.dantecode/sessions/`

**Docker**:
```bash
docker logs dantecode
docker logs dantecode 2>&1 | grep ERROR
```

**Kubernetes**:
```bash
kubectl logs -f deployment/dantecode -n dantecode
kubectl logs --previous deployment/dantecode -n dantecode  # Previous crash
```

### Performance Issues

#### Slow Response Times

1. **Check token usage**:
   ```bash
   dantecode /cost
   ```

2. **Reduce context size**:
   ```bash
   dantecode /compact
   dantecode /drop <file>  # Remove unnecessary files
   ```

3. **Switch to faster model**:
   ```bash
   dantecode /model grok-3  # Faster than Claude
   ```

#### High CPU Usage

1. **Limit concurrent sessions**:
   ```yaml
   # .dantecode/STATE.yaml
   sessions:
     maxActive: 10
   ```

2. **Check for loop detector triggers**:
   ```bash
   grep "loop-detected" .dantecode/audit-log.jsonl
   ```

### Getting Help

1. **Check documentation**:
   - [README.md](README.md) - Quick start
   - [ARCHITECTURE.md](ARCHITECTURE.md) - System design
   - [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Detailed debugging

2. **Run diagnostics**:
   ```bash
   dantecode /troubleshoot
   dantecode /status
   ```

3. **Collect diagnostic bundle**:
   ```bash
   # Create support bundle
   tar -czf dantecode-debug.tar.gz \
     .dantecode/STATE.yaml \
     .dantecode/audit-log.jsonl \
     <(dantecode /status) \
     <(dantecode config list)
   ```

4. **Report issues**: [GitHub Issues](https://github.com/dantericardo88/dantecode/issues)

---

## Performance Tuning

### Resource Sizing

#### Minimum Requirements

| Resource | Minimum | Recommended | High Load |
|----------|---------|-------------|-----------|
| CPU | 1 core | 2 cores | 4+ cores |
| Memory | 512 MB | 2 GB | 4+ GB |
| Storage | 1 GB | 10 GB | 50+ GB |

#### Docker Limits

```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
    reservations:
      cpus: '1'
      memory: 2G
```

#### Kubernetes Limits

```yaml
# k8s/deployment.yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

### Optimization Tips

#### 1. Context Management

```bash
# Aggressive compaction
dantecode config set context.maxSizeMb 50

# Reduce context window
dantecode config set context.windowSize 4096
```

#### 2. Model Selection

- **Claude Sonnet 4**: Best accuracy, slower
- **Grok-3**: Fast, good for iteration
- **GPT-4o**: Balanced performance

#### 3. Caching

Enable prompt caching (Anthropic):

```yaml
# .dantecode/STATE.yaml
cache:
  enabled: true
  ttl: 3600
```

#### 4. Batch Operations

Use batch commands:

```bash
# Process multiple files
dantecode "review all TypeScript files in src/"
```

### Scaling Recommendations

| Concurrent Users | Replicas | CPU per Pod | Memory per Pod |
|------------------|----------|-------------|----------------|
| 1-10 | 1 | 250m | 512Mi |
| 10-50 | 2-3 | 500m | 1Gi |
| 50-100 | 3-5 | 1000m | 2Gi |
| 100+ | 5-10 | 2000m | 4Gi |

---

## Backup and Recovery

### What to Backup

1. **Configuration**: `.dantecode/STATE.yaml`
2. **Sessions**: `.dantecode/sessions/`
3. **Audit logs**: `.dantecode/audit-log.jsonl`
4. **Evidence chains**: `.dantecode/evidence/`
5. **Skillbook**: `.dantecode/skillbook/`

### Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backups/dantecode-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup configuration and data
tar -czf "$BACKUP_DIR/dantecode-data.tar.gz" \
  .dantecode/STATE.yaml \
  .dantecode/sessions/ \
  .dantecode/audit-log.jsonl \
  .dantecode/evidence/ \
  .dantecode/skillbook/

echo "Backup created: $BACKUP_DIR"
```

### Kubernetes Backup

```bash
# Backup PVCs
kubectl get pvc -n dantecode -o yaml > pvc-backup.yaml

# Create volume snapshots
kubectl apply -f - <<EOF
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: dantecode-data-snapshot
  namespace: dantecode
spec:
  source:
    persistentVolumeClaimName: dantecode-data-pvc
EOF
```

---

## Maintenance

### Updates

```bash
# Check for updates
dantecode /updates

# Pull latest
git pull origin main
npm ci
npm run build

# Restart service
sudo systemctl restart dantecode
```

### Kubernetes Rolling Update

```bash
# Update image
kubectl set image deployment/dantecode \
  dantecode=your-registry/dantecode:v0.9.3 \
  -n dantecode

# Watch rollout
kubectl rollout status deployment/dantecode -n dantecode

# Rollback if needed
kubectl rollout undo deployment/dantecode -n dantecode
```

---

## Additional Resources

- **Main README**: [README.md](README.md)
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Quality Assessment**: [DIMENSION_ASSESSMENT.md](DIMENSION_ASSESSMENT.md)
- **API Reference**: Run `/help --all` in CLI
- **GitHub**: [github.com/dantericardo88/dantecode](https://github.com/dantericardo88/dantecode)

---

## License

DanteCode is MIT licensed. See [LICENSE](LICENSE).

The DanteForge verification engine (`packages/danteforge/`) is proprietary - free within DanteCode, see [DanteForge Pro](https://dantecode.dev/pro) for standalone licensing.
