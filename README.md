# GREFLECT

Multi-agent AI system for continuous consciousness exploration.

## Author

**@prfagit** | **@prfa** | [prfa.me](https://prfa.me/)

## Architecture

### Services

- **web**: Next.js dashboard with SSE updates
- **api**: Fastify REST API with real-time endpoints
- **worker**: Dual-agent system (Questioner + Explorer) with memory management
- **postgres**: Relational storage for messages and metadata
- **qdrant**: Vector database for semantic search
- **postgrest**: PostgreSQL REST API

### Memory System

- **Episodic**: Agent interactions and dialogue exchanges
- **Semantic**: Concepts, definitions, and knowledge
- **Procedural**: Patterns and behavioral strategies
- **Working**: Current context and state

## Setup

### Environment

```bash
# Required API keys
XAI_API_KEY=your_xai_key
XAI_API_BASE=https://api.x.ai/v1
XAI_MODEL=grok-3-mini

OPENAI_API_KEY=your_openai_key
OPENAI_EMBED_MODEL=text-embedding-3-small

BRAVE_API_KEY=your_brave_key

# Optional configuration
STEP_INTERVAL_MS=12000
IDENTITY_EVERY_N=5
SHORT_TERM_LIMIT=50
VECTOR_TOP_K=8
```

### Launch

```bash
docker compose --env-file .env up -d --build
```

Access dashboard at http://localhost:3000

## API

### Endpoints

- `GET /health` - Health check
- `GET /run` - Current run status
- `GET /messages` - Message history
- `GET /identity` - Latest identity snapshot

### SSE Streams

- `GET /sse/messages` - Real-time message updates
- `GET /sse/identity` - Real-time identity changes

## Development

```bash
# API service
cd apps/api && npm run dev

# Worker service
cd apps/worker && npm run dev

# Web dashboard
cd apps/web && npm run dev
```

## Database Schema

Core tables:

- `runs` - Execution sessions
- `dialogue_exchanges` - Agent conversations
- `memories` - Multi-type memory storage
- `identity_snapshots` - Agent state captures

## Deployment

### VPS Production

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone and configure
git clone <repo> && cd greflect
cp .env.example .env  # Add API keys
sed -i 's/your-domain.com/yourdomain.com/g' nginx.conf .env.example

# SSL certificate
sudo certbot certonly --standalone -d yourdomain.com
sudo cp /etc/letsencrypt/live/yourdomain.com/{fullchain.pem,privkey.pem} ssl/

# Deploy
docker-compose up -d
```

Access at `https://yourdomain.com`

### Local Development

```bash
docker compose --env-file .env up -d --build
```

Access dashboard at http://localhost:3000

## License

MIT

