# DanteCode Quick Deployment Reference

One-page cheat sheet for deploying DanteCode. See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive guide.

## Prerequisites

- Node.js 20+
- Docker (optional)
- At least one API key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, etc.

## 30-Second Start

```bash
# Install globally
npm install -g @dantecode/cli

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run
dantecode "build me a todo app"
```

## Docker Quick Start

```bash
# 1. Configure
cp .env.example .env
nano .env  # Add your ANTHROPIC_API_KEY

# 2. Start
docker-compose up -d

# 3. Verify
curl http://localhost:3000/api/health
./scripts/verify-deployment.sh
```

## Kubernetes Quick Start

```bash
# 1. Create secrets
kubectl create secret generic dantecode-secrets \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --namespace=dantecode

# 2. Deploy
kubectl apply -f k8s/deployment.yaml -n dantecode
kubectl apply -f k8s/service.yaml -n dantecode

# 3. Verify
kubectl get pods -n dantecode
kubectl logs -f deployment/dantecode -n dantecode
```

## Essential Environment Variables

```bash
# Required (pick one)
ANTHROPIC_API_KEY=sk-ant-...    # Recommended
OPENAI_API_KEY=sk-proj-...
XAI_API_KEY=xai-...

# Recommended
LOG_LEVEL=info
NODE_ENV=production

# Optional
GITHUB_TOKEN=ghp_...            # For /review, /triage
DANTECODE_API_TOKEN=xxx         # API authentication
```

## Health Endpoints

```bash
# Liveness (detailed)
curl http://localhost:3000/api/health

# Readiness (simple)
curl http://localhost:3000/api/ready

# Status (CLI)
dantecode /status
```

## Common Commands

```bash
# Initialize project
dantecode init

# Check status
dantecode /status

# List sessions
dantecode /sessions

# View help
dantecode /help --all

# Check configuration
dantecode config list

# Set PDSE threshold
dantecode config set pdse.threshold 90
```

## Troubleshooting

```bash
# Check logs (Docker)
docker logs dantecode

# Check logs (Kubernetes)
kubectl logs -f deployment/dantecode -n dantecode

# Debug mode
export DANTECODE_DEBUG=1

# Verify deployment
./scripts/verify-deployment.sh

# Manual health check
curl -v http://localhost:3000/api/health | jq
```

## Quick Fixes

**"No API keys configured"**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Build fails**
```bash
npm run clean && npm ci && npm run build
```

**Port conflict**
```bash
# Change port in docker-compose.yml or use:
docker run -p 3001:3000 dantecode:latest
```

**High memory**
```bash
dantecode config set sessions.maxActive 50
dantecode /compact
```

## Resource Limits

| Scale | CPU | Memory | Replicas |
|-------|-----|--------|----------|
| Dev | 250m | 512Mi | 1 |
| Production | 1000m | 2Gi | 2-3 |
| High Load | 2000m | 4Gi | 5-10 |

## Security Checklist

- [ ] Secrets in environment/vault (NOT git)
- [ ] TLS/HTTPS enabled
- [ ] API token configured
- [ ] Running as non-root
- [ ] Firewall rules set
- [ ] Rate limiting enabled
- [ ] Backups configured

## Files Created

- `Dockerfile` - Production image
- `docker-compose.yml` - Full stack
- `.env.example` - Environment template
- `k8s/deployment.yaml` - K8s deployment
- `k8s/service.yaml` - K8s service + ingress
- `k8s/secrets.yaml` - K8s secrets template
- `scripts/verify-deployment.sh` - Health check script

## Next Steps

1. Read [DEPLOYMENT.md](DEPLOYMENT.md) for full guide
2. Configure monitoring (Prometheus + Grafana)
3. Set up backups
4. Enable TLS/HTTPS
5. Configure rate limiting
6. Review [ARCHITECTURE.md](ARCHITECTURE.md)

## Support

- Documentation: [DEPLOYMENT.md](DEPLOYMENT.md)
- Issues: [github.com/dantericardo88/dantecode/issues](https://github.com/dantericardo88/dantecode/issues)
- CLI help: `dantecode /help --all`
