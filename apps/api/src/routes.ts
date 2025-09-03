import { FastifyInstance } from 'fastify';
import { pool } from './index.js';

export async function routes(fastify: FastifyInstance) {

  // Get current run
  fastify.get('/run', async () => {
    const result = await pool.query(`
      SELECT id, started_at, status, goal, model
      FROM runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return { error: 'No active run found' };
    }

    return result.rows[0];
  });

  // Get messages for current run
  fastify.get('/messages', async () => {
    const runResult = await pool.query(`
      SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
    `);

    if (runResult.rows.length === 0) {
      return [];
    }

    const messages = await pool.query(`
      SELECT iteration, role, content, created_at
      FROM messages
      WHERE run_id = $1
      ORDER BY iteration ASC
    `, [runResult.rows[0].id]);

    return messages.rows;
  });

  // Get latest identity snapshot
  fastify.get('/identity', async () => {
    const runResult = await pool.query(`
      SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
    `);

    if (runResult.rows.length === 0) {
      return { error: 'No active run found' };
    }

    const identity = await pool.query(`
      SELECT identity, iteration, created_at
      FROM identity_snapshots
      WHERE run_id = $1
      ORDER BY iteration DESC
      LIMIT 1
    `, [runResult.rows[0].id]);

    if (identity.rows.length === 0) {
      return { error: 'No identity snapshot found' };
    }

    return identity.rows[0];
  });

  // SSE endpoint for real-time messages
  fastify.get('/sse/messages', async function (request, reply) {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    let lastMessageId = 0;

    // Send initial data
    const runResult = await pool.query(`
      SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
    `);

    if (runResult.rows.length > 0) {
      const messages = await pool.query(`
        SELECT id, iteration, role, content, created_at
        FROM messages
        WHERE run_id = $1
        ORDER BY id ASC
      `, [runResult.rows[0].id]);

      for (const message of messages.rows) {
        reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
        lastMessageId = message.id;
      }
    }

    // Poll for new messages every 1 second
    const interval = setInterval(async () => {
      try {
        const runCheck = await pool.query(`
          SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
        `);

        if (runCheck.rows.length > 0) {
          const newMessages = await pool.query(`
            SELECT id, iteration, role, content, created_at
            FROM messages
            WHERE run_id = $1 AND id > $2
            ORDER BY id ASC
          `, [runCheck.rows[0].id, lastMessageId]);

          for (const message of newMessages.rows) {
            reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
            lastMessageId = message.id;
          }
        }
      } catch (error) {
        console.error('SSE error:', error);
      }
    }, 1000);

    // Clean up on client disconnect
    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  // SSE endpoint for identity snapshots
  fastify.get('/sse/identity', async function (request, reply) {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    let lastIteration = 0;

    // Send initial identity
    const runResult = await pool.query(`
      SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
    `);

    if (runResult.rows.length > 0) {
      const identity = await pool.query(`
        SELECT identity, iteration, created_at
        FROM identity_snapshots
        WHERE run_id = $1
        ORDER BY iteration DESC
        LIMIT 1
      `, [runResult.rows[0].id]);

      if (identity.rows.length > 0) {
        reply.raw.write(`data: ${JSON.stringify(identity.rows[0])}\n\n`);
        lastIteration = identity.rows[0].iteration;
      }
    }

    // Poll for new identity snapshots every 2 seconds
    const interval = setInterval(async () => {
      try {
        const runCheck = await pool.query(`
          SELECT id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
        `);

        if (runCheck.rows.length > 0) {
          const newIdentity = await pool.query(`
            SELECT identity, iteration, created_at
            FROM identity_snapshots
            WHERE run_id = $1 AND iteration > $2
            ORDER BY iteration DESC
            LIMIT 1
          `, [runCheck.rows[0].id, lastIteration]);

          if (newIdentity.rows.length > 0) {
            reply.raw.write(`data: ${JSON.stringify(newIdentity.rows[0])}\n\n`);
            lastIteration = newIdentity.rows[0].iteration;
          }
        }
      } catch (error) {
        console.error('Identity SSE error:', error);
      }
    }, 2000);

    // Clean up on client disconnect
    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });
}
