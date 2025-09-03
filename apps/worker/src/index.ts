import { Pool } from 'pg';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GreflectV2 } from './greflect-v2.js';
import { BraveSearch } from './brave-search.js';

async function main() {
  console.log('Starting GREFLECT v2');
  
  try {
    // Initialize clients
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
    });

    const gptClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const grokClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: process.env.XAI_API_BASE,
    });

    const qdrant = new QdrantClient({
      url: process.env.QDRANT_URL,
    });

    const braveSearch = new BraveSearch(process.env.BRAVE_API_KEY!);

    // Initialize and start the advanced agent
    const agent = new GreflectV2(pool, gptClient, grokClient, qdrant, braveSearch);
    await agent.initialize();
    await agent.start();
  } catch (error) {
    console.error('Fatal error in GREFLECT v2:', error);
    process.exit(1);
  }
}

main().catch(console.error);
