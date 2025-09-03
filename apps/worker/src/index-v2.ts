import { Pool } from 'pg';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GreflectV2 } from './greflect-v2.js';
import { BraveSearch } from './brave-search.js';

/**
 * GREFLECT v2 Main Entry Point
 * Advanced Multi-Agent Consciousness Exploration System
 */

async function main() {
  console.log('Starting GREFLECT v2');
  console.log('');

  try {
    // Initialize database connection
    console.log('Connecting to PostgreSQL...');
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
    });

    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');

    // Initialize OpenAI clients
    console.log('Initializing AI models...');

    const gptClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: 'https://api.openai.com/v1'
    });

    const grokClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: process.env.XAI_API_BASE,
    });

    console.log('AI models initialized');
    console.log(`Questioner: GPT-5-nano`);
    console.log(`Explorer: ${process.env.XAI_MODEL}`);

    // Initialize vector database
    console.log('Connecting to Qdrant vector database...');
    const qdrant = new QdrantClient({
      url: process.env.QDRANT_URL,
    });

    // Test vector database
    try {
      await qdrant.getCollections();
      console.log('Vector database connected successfully');
    } catch (error) {
      console.log('Vector database connection issue:', error instanceof Error ? error.message : error);
    }

    // Initialize web search
    console.log('Initializing web search capabilities...');
    const braveSearch = new BraveSearch(process.env.BRAVE_API_KEY!);
    console.log('Web search initialized');

    // Create GREFLECT v2 system
    console.log('');
    console.log('Creating GREFLECT v2 system...');
    const greflect = new GreflectV2(
      pool,
      gptClient,
      grokClient,
      qdrant,
      braveSearch
    );

    // Initialize the system
    await greflect.initialize();

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nReceived shutdown signal...');
      await greflect.stop();
      await pool.end();
      console.log('GREFLECT v2 shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start the consciousness exploration process
    console.log('');
    console.log('Starting consciousness exploration dialogue...');
    console.log('');

    await greflect.start();

  } catch (error) {
    console.error('Critical error starting GREFLECT v2:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error(error.stack);
  process.exit(1);
});

// Start the system
main().catch(console.error);