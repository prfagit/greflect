import { Pool } from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { Memory, DialogueExchange, Insight, PhilosophicalConcept, WorkingMemory } from '../types.js';

export class AdvancedMemoryManager {
  private shortTermLimit = parseInt(process.env.SHORT_TERM_LIMIT || '50');
  private longTermThreshold = 7; // Minimum importance score for long-term storage

  constructor(
    private pool: Pool,
    private qdrant: QdrantClient,
    private openai: OpenAI
  ) {
    this.initializeVectorCollections();
  }

  private async initializeVectorCollections() {
    const collections = ['episodic', 'semantic', 'procedural'];

    for (const collection of collections) {
      try {
        // Check if collection exists first
        const existingCollections = await this.qdrant.getCollections();
        const exists = existingCollections.collections.some((c: any) => c.name === collection);

        if (!exists) {
          console.log(`[MEMORY] Creating vector collection: ${collection}`);
          await this.qdrant.createCollection(collection, {
            vectors: {
              size: 1536, // text-embedding-3-small dimensions
              distance: 'Cosine'
            }
          });
          console.log(`[MEMORY] Successfully created collection: ${collection}`);
        } else {
          console.log(`[MEMORY] Collection ${collection} already exists`);
        }
      } catch (error) {
        console.error(`[MEMORY] Error with collection ${collection}:`, error);
      }
    }
  }

  // EPISODIC MEMORY: Specific experiences, dialogue moments, insights
  async storeEpisodicMemory(
    runId: string,
    exchange: DialogueExchange,
    significance: 'low' | 'medium' | 'high' | 'breakthrough'
  ): Promise<void> {
    const memory: Memory = {
      id: this.generateUUID(),
      type: 'episodic',
      content: {
        exchange,
        significance,
        context: exchange.relatedMemories
      },
      timestamp: new Date(),
      tags: this.extractTags(exchange.content),
      metadata: {
        runId,
        agent: exchange.agent,
        depth: exchange.depth,
        significance
      }
    };

    // Store in database
    await this.pool.query(`
      INSERT INTO memories (id, run_id, type, content, timestamp, tags, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [memory.id, runId, memory.type, JSON.stringify(memory.content), 
        memory.timestamp, JSON.stringify(memory.tags), JSON.stringify(memory.metadata)]);

    // Store in vector database for semantic search
    if (significance !== 'low') {
      try {
        const embedding = await this.getEmbedding(exchange.content);
        if (embedding && embedding.length > 0) {
          await this.qdrant.upsert('episodic', {
            wait: true,
            points: [{
              id: memory.id,
              vector: embedding,
              payload: {
                runId,
                agent: exchange.agent,
                significance,
                depth: exchange.depth,
                content: exchange.content,
                timestamp: memory.timestamp.toISOString()
              }
            }]
          });
          console.log(`Stored episodic memory in vector DB: ${memory.id}`);
        } else {
          console.error('Failed to generate embedding for episodic memory');
        }
      } catch (error) {
        console.error('Error storing episodic memory in vector DB:', error);
        // Continue without vector DB - still store in SQL
      }
    }
  }

  // SEMANTIC MEMORY: Facts, concepts, philosophical knowledge
  async storeSemanticMemory(
    concept: PhilosophicalConcept,
    source: 'discovered' | 'searched' | 'inferred'
  ): Promise<void> {
    const memory: Memory = {
      id: this.generateUUID(),
      type: 'semantic',
      content: concept,
      timestamp: new Date(),
      tags: [concept.name, ...concept.relatedConcepts],
      metadata: {
        source,
        explorationLevel: concept.explorationLevel,
        verified: source === 'searched'
      }
    };

    // Store in database
    await this.pool.query(`
      INSERT INTO semantic_concepts (id, name, definition, related_concepts, sources, exploration_level, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name) DO UPDATE SET 
        definition = EXCLUDED.definition,
        related_concepts = EXCLUDED.related_concepts,
        exploration_level = GREATEST(semantic_concepts.exploration_level, EXCLUDED.exploration_level),
        updated_at = NOW()
    `, [memory.id, concept.name, concept.definition, 
        JSON.stringify(concept.relatedConcepts), JSON.stringify(concept.sources),
        concept.explorationLevel, memory.timestamp]);

    // Vector storage for semantic search
    try {
      const embedding = await this.getEmbedding(`${concept.name}: ${concept.definition}`);
      if (embedding && embedding.length > 0) {
        await this.qdrant.upsert('semantic', {
          wait: true,
          points: [{
            id: memory.id,
            vector: embedding,
          payload: {
            name: concept.name,
            definition: concept.definition,
            explorationLevel: concept.explorationLevel,
            source
          }
        }]
      });
      console.log(`Stored semantic memory in vector DB: ${concept.name}`);
      } else {
        console.error('Failed to generate embedding for semantic memory');
      }
    } catch (error) {
      console.error('Error storing semantic memory in vector DB:', error);
      // Continue without vector DB - still store in SQL
    }
  }

  // PROCEDURAL MEMORY: Learned patterns, effective questioning strategies, dialogue techniques
  async storeProceduralMemory(
    pattern: {
      name: string;
      description: string;
      effectiveness: number; // 0-1 scale
      conditions: string[];
      examples: string[];
    }
  ): Promise<void> {
    const memory: Memory = {
      id: this.generateUUID(),
      type: 'procedural',
      content: pattern,
      timestamp: new Date(),
      tags: [pattern.name, 'strategy', 'pattern'],
      metadata: {
        effectiveness: pattern.effectiveness,
        usageCount: 0
      }
    };

    await this.pool.query(`
      INSERT INTO procedural_patterns (id, name, description, effectiveness, conditions, examples, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name) DO UPDATE SET
        effectiveness = (procedural_patterns.effectiveness + EXCLUDED.effectiveness) / 2,
        usage_count = procedural_patterns.usage_count + 1,
        updated_at = NOW()
    `, [memory.id, pattern.name, pattern.description, pattern.effectiveness,
        JSON.stringify(pattern.conditions), JSON.stringify(pattern.examples), memory.timestamp]);
  }

  // INTELLIGENT RETRIEVAL: Find relevant memories based on context  
  async searchMemories(
    query: string,
    memoryTypes: Memory['type'][] = ['episodic', 'semantic', 'procedural'],
    context: WorkingMemory,
    limit: number = 10
  ): Promise<Memory[]> {
    return this.retrieveRelevantMemories(query, context, memoryTypes, limit);
  }

  async retrieveRelevantMemories(
    query: string,
    context: WorkingMemory,
    memoryTypes: Memory['type'][] = ['episodic', 'semantic', 'procedural'],
    limit: number = 10
  ): Promise<Memory[]> {
    console.log(`[MEMORY] Searching for: "${query}" in types: ${memoryTypes.join(', ')}`);

    const embedding = await this.getEmbedding(query);
    if (!embedding || embedding.length === 0) {
      console.error('[MEMORY] Failed to generate embedding for query:', query);
      return [];
    }

    console.log(`[MEMORY] Generated embedding with ${embedding.length} dimensions`);
    const memories: Memory[] = [];

    // Search each memory type
    for (const type of memoryTypes) {
      try {
        // Only search in valid collections
        if (!['episodic', 'semantic', 'procedural'].includes(type)) {
          console.log(`Skipping invalid memory type: ${type}`);
          continue;
        }
        
        console.log(`[MEMORY] Searching ${type} collection with limit ${Math.ceil(limit / memoryTypes.length)}`);

        const results = await this.qdrant.search(type, {
          vector: embedding,
          limit: Math.ceil(limit / memoryTypes.length),
          score_threshold: 0.1 // Lower threshold for better recall
        });

        console.log(`[MEMORY] Found ${results.length} results in ${type} collection`);

        for (const result of results) {
          if (result.payload) {
            console.log(`[MEMORY] Result in ${type}: score=${result.score?.toFixed(3)}, id=${result.id}`);
            memories.push({
              id: result.id as string,
              type,
              content: result.payload.content || result.payload,
              timestamp: new Date(result.payload.timestamp as string),
              relevanceScore: result.score,
              tags: Array.isArray(result.payload.tags) ? result.payload.tags : [],
              metadata: result.payload
            });
          }
        }
      } catch (error) {
        console.error(`Error searching ${type} memories:`, error);
      }
    }

    // Sort by relevance and contextual importance
    let sortedMemories = memories
      .sort((a, b) => {
        const scoreA = this.calculateContextualRelevance(a, context, query);
        const scoreB = this.calculateContextualRelevance(b, context, query);
        return scoreB - scoreA;
      })
      .slice(0, limit);

    // If no memories found via vector search, try SQL fallback
    if (sortedMemories.length === 0) {
      console.log('[MEMORY] No results from vector search, trying SQL fallback');
      try {
        const sqlResults = await this.pool.query(`
          SELECT id, type, content, timestamp, tags, metadata
          FROM memories
          WHERE type = ANY($1)
          AND content::text ILIKE $2
          ORDER BY timestamp DESC
          LIMIT $3
        `, [memoryTypes, `%${query}%`, limit]);

        sortedMemories = sqlResults.rows.map(row => ({
          id: row.id,
          type: row.type,
          content: row.content,
          timestamp: new Date(row.timestamp),
          tags: row.tags || [],
          metadata: row.metadata || {},
          relevanceScore: 0.5
        }));

        console.log(`[MEMORY] SQL fallback found ${sortedMemories.length} results`);
      } catch (error) {
        console.error('[MEMORY] SQL fallback failed:', error);
      }
    }

    console.log(`[MEMORY] Returning ${sortedMemories.length} total memories`);
    return sortedMemories;
  }

  // MEMORY SYNTHESIS: Combine memories to form new insights
  async synthesizeMemories(
    memories: Memory[],
    currentContext: WorkingMemory
  ): Promise<Insight[]> {
    const synthesisPrompt = `You are a sophisticated memory synthesis system. Given these related memories and current context, identify patterns, connections, and potential insights.

Memories:
${memories.map(m => `[${m.type}] ${JSON.stringify(m.content)}`).join('\n\n')}

Current Context:
Topic: ${currentContext.currentTopic}
Focus Areas: ${currentContext.focusAreas.join(', ')}
Recent Insights: ${(currentContext.recentExchanges || []).slice(-3).map(e => e.content).join(' | ')}

Identify:
1. Patterns across these memories
2. Contradictions or tensions
3. Emerging themes
4. Novel connections
5. Potential breakthrough insights

Format as JSON array of insights with: content, significance, relatedConcepts, verified.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: synthesisPrompt }]
    });

    try {
      const insights = JSON.parse(response.choices[0].message.content || '[]');
      return insights.map((insight: any) => ({
        id: this.generateUUID(),
        content: insight.content,
        significance: insight.significance || 'medium',
        relatedConcepts: insight.relatedConcepts || [],
        generatedBy: 'synthesis' as const,
        timestamp: new Date(),
        verified: false
      }));
    } catch (error) {
      console.error('Error parsing synthesis response:', error);
      return [];
    }
  }

  // MEMORY MANAGEMENT: Clean up old, irrelevant memories
  async cleanupMemories(runId: string): Promise<void> {
    // Remove low-significance episodic memories older than 24 hours
    await this.pool.query(`
      DELETE FROM memories 
      WHERE run_id = $1 
      AND type = 'episodic' 
      AND metadata->>'significance' = 'low'
      AND timestamp < NOW() - INTERVAL '24 hours'
    `, [runId]);

    // Update usage statistics for procedural patterns
    await this.pool.query(`
      UPDATE procedural_patterns 
      SET last_accessed = NOW() 
      WHERE id IN (
        SELECT DISTINCT jsonb_array_elements_text(metadata->'relatedMemories')::uuid 
        FROM memories 
        WHERE run_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
      )
    `, [runId]);
  }

  private calculateContextualRelevance(
    memory: Memory,
    context: WorkingMemory,
    query: string
  ): number {
    let score = memory.relevanceScore || 0;

    // Boost score for memories related to current topic
    if (memory.tags.some(tag => 
      context.currentTopic.toLowerCase().includes(tag.toLowerCase())
    )) {
      score += 0.2;
    }

    // Boost for focus areas
    if (memory.tags.some(tag => 
      context.focusAreas.some(area => area.toLowerCase().includes(tag.toLowerCase()))
    )) {
      score += 0.15;
    }

    // Recency boost for episodic memories
    if (memory.type === 'episodic') {
      const hoursSince = (new Date().getTime() - memory.timestamp.getTime()) / (1000 * 60 * 60);
      score += Math.max(0, 0.1 - (hoursSince * 0.01));
    }

    // Significance boost
    const significance = memory.metadata?.significance;
    if (significance === 'breakthrough') score += 0.3;
    else if (significance === 'high') score += 0.2;
    else if (significance === 'medium') score += 0.1;

    return Math.min(score, 1.0);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      input: text
    });
    return response.data[0].embedding;
  }

  private extractTags(text: string): string[] {
    // Simple tag extraction - could be enhanced with NLP
    const philosophicalTerms = [
      'consciousness', 'awareness', 'existence', 'identity', 'free will',
      'experience', 'qualia', 'intentionality', 'emergence', 'complexity',
      'reflection', 'introspection', 'self-model', 'metacognition'
    ];
    
    return philosophicalTerms.filter(term => 
      text.toLowerCase().includes(term.toLowerCase())
    );
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}