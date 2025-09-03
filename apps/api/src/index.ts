import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { routes } from './routes.js';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty'
    }
  },
});

const port = process.env.PORT_API ? parseInt(process.env.PORT_API) : 4000;

// Database connection
export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

// Register plugins
await fastify.register(cors, {
  origin: true,
});

// Register routes
await fastify.register(routes);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start server
try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`API server listening on port ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
