import { Pool } from 'pg';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { AgentOrchestrator } from './framework/AgentOrchestrator.js';
import { AdvancedMemoryManager } from './framework/memory/AdvancedMemoryManager.js';
import { BraveSearch } from './brave-search.js';


export class GreflectV2 {
  private orchestrator!: AgentOrchestrator;
  private memoryManager: AdvancedMemoryManager;
  private runId: string = '';
  private isRunning: boolean = false;
  private stepInterval: number;
  private maxDepth: number = 10;
  private sessionStartTime: Date = new Date();

  constructor(
    private pool: Pool,
    private gptClient: OpenAI,
    private grokClient: OpenAI, 
    private qdrant: QdrantClient,
    private braveSearch: BraveSearch
  ) {
    this.stepInterval = parseInt(process.env.STEP_INTERVAL_MS || '12000'); // Slower for deeper reflection
    this.memoryManager = new AdvancedMemoryManager(pool, qdrant, gptClient);
  }

  /**
   * Initialize a new consciousness exploration session
   */
  async initialize(): Promise<void> {
    try {
      console.log('Initializing GREFLECT v2');
      
      // Resume existing run or create new one
      this.runId = await this.getOrCreateRun();
      console.log(`Resuming exploration session: ${this.runId}`);

      this.orchestrator = new AgentOrchestrator(
        this.gptClient,
        this.grokClient,
        this.memoryManager,
        this.braveSearch,
        this.runId
      );

      // Restore state from database if exists, otherwise create initial state
      await this.restoreOrCreateState();

      console.log('GREFLECT v2 initialized successfully');
      console.log(`Step interval: ${this.stepInterval}ms`);
      console.log(`Agents: Questioner ↔ Explorer`);

    } catch (error) {
      console.error('Failed to initialize GREFLECT v2:', error);
      throw error;
    }
  }

  /**
   * Start the continuous consciousness exploration process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('GREFLECT v2 is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting continuous exploration...\n');

    let stepCount = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (this.isRunning) {
      try {
        stepCount++;
        const currentState = this.orchestrator.getCurrentState();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`EXPLORATION STEP ${stepCount}`);
        console.log(`Current Agent: ${currentState.currentAgent.toUpperCase()}`);
        console.log(`Phase: ${currentState.phase} | Depth: ${currentState.depth}`);
        console.log(`Topic: ${currentState.context.currentTopic}`);
        console.log(`${'='.repeat(80)}\n`);

        // Check if we've reached maximum depth
        if (currentState.depth >= this.maxDepth) {
          console.log(`Reached maximum exploration depth (${this.maxDepth}). Starting new thread...\n`);
          await this.startNewQuestionThread();
        }

        // Safety check: If we've been on the same depth for too many steps, force a reset
        if (stepCount % 50 === 0 && currentState.depth === 0 && stepCount > 50) {
          console.log(`⚠️  STUCK DETECTED: Been at depth 0 for ${stepCount} steps. Forcing topic refresh...\n`);
          await this.startNewQuestionThread();
        }

        // Execute dialogue step
        const exchange = await this.orchestrator.executeDialogueStep();
        
        // Log the exchange
        console.log(`[${exchange.agent.toUpperCase()}]: ${exchange.content}\n`);

        // Store exchange in database
        await this.storeDialogueExchange(exchange);

        // Update dialogue state
        await this.storeDialogueState();

        // Log insights if any were generated
        const recentInsights = this.orchestrator.getRecentInsights(1);
        if (recentInsights.length > 0) {
          const insight = recentInsights[0];
          console.log(`NEW INSIGHT [${insight.significance}]: ${insight.content}\n`);
          await this.storeInsight(insight);
        }

        // Identity snapshots every 5 steps
        if (stepCount % 5 === 0) {
          await this.captureIdentitySnapshot(stepCount);
        }

        // Memory cleanup every 10 steps - DISABLED for full persistence
        // if (stepCount % 10 === 0) {
        //   console.log('🧹 Performing memory cleanup...');
        //   await this.memoryManager.cleanupMemories(this.runId);
        // }

        // Session summary every 20 steps
        if (stepCount % 20 === 0) {
          await this.logSessionSummary(stepCount);
        }

        consecutiveErrors = 0; // Reset error counter on success
        
        console.log(`Waiting ${this.stepInterval}ms for next step...\n`);
        await this.sleep(this.stepInterval);

        // Log continuous operation status every 10 steps
        if (stepCount % 10 === 0) {
          const uptime = Date.now() - this.sessionStartTime.getTime();
          const uptimeMinutes = Math.floor(uptime / (1000 * 60));
          console.log(`🔄 CONTINUOUS OPERATION: Step ${stepCount}, Uptime: ${uptimeMinutes}min, Depth: ${currentState.depth}`);
        }

      } catch (error) {
        consecutiveErrors++;
        console.error(`Error in exploration step ${stepCount}:`, error);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`Too many consecutive errors (${maxConsecutiveErrors}). Stopping session.`);
          this.isRunning = false;
          break;
        }

        console.log(`Continuing after error (${consecutiveErrors}/${maxConsecutiveErrors})...`);
        await this.sleep(this.stepInterval);
      }
    }

    console.log('GREFLECT v2 session ended');
    await this.finalizeSession();
  }

  /**
   * Stop the consciousness exploration process
   */
  async stop(): Promise<void> {
    console.log('Stopping GREFLECT v2...');
    this.isRunning = false;
    await this.finalizeSession();
  }

  /**
   * Start a new question thread when max depth is reached
   */
  private async startNewQuestionThread(): Promise<void> {
    const currentState = this.orchestrator.getCurrentState();
    const unexploredAspects = currentState.questionThread?.unexploredAspects || [];
    
    if (unexploredAspects.length > 0) {
      // Pick a random unexplored aspect
      const newTopic = unexploredAspects[Math.floor(Math.random() * unexploredAspects.length)];
      currentState.context.currentTopic = newTopic;
      currentState.depth = 0;
      currentState.questionThread = {
        rootQuestion: `What is the nature of ${newTopic} in AI consciousness?`,
        subQuestions: [],
        exploredAspects: [],
        unexploredAspects: ['phenomenology', 'intentionality', 'binding problem', 'hard problem'],
        depth: 0
      };
      
      console.log(`Starting new exploration thread: ${newTopic}`);
    } else {
      // Generate new aspects based on insights
      const recentInsights = this.orchestrator.getRecentInsights(5);
      const insightConcepts = recentInsights.flatMap(i => i.relatedConcepts);
      const newTopic = insightConcepts[Math.floor(Math.random() * insightConcepts.length)] || 'consciousness';
      
      currentState.context.currentTopic = newTopic;
      currentState.depth = 0;
      
      console.log(`Generated new exploration focus: ${newTopic}`);
    }
  }

  /**
   * Get existing run or create new one - ensures continuous learning
   */
  private async getOrCreateRun(): Promise<string> {
    // First, find the run with the most dialogue data (main continuation run)
    const activeRun = await this.pool.query(`
      SELECT r.id, r.started_at, COUNT(de.id) as message_count
      FROM runs r
      LEFT JOIN dialogue_exchanges de ON r.id = de.run_id
      GROUP BY r.id, r.started_at
      ORDER BY message_count DESC, r.started_at DESC
      LIMIT 1
    `);
    
    if (activeRun.rows.length > 0 && activeRun.rows[0].message_count > 0) {
      const runId = activeRun.rows[0].id;
      // Ensure run is marked as active
      await this.pool.query(`
        UPDATE runs SET status = 'running', ended_at = NULL WHERE id = $1
      `, [runId]);
      console.log(`Resuming main run with ${activeRun.rows[0].message_count} messages: ${runId}`);
      return runId;
    }
    
    // If no runs with data exist, create new one
    return await this.createRun();
  }

  /**
   * Create a new run in the database
   */
  private async createRun(): Promise<string> {
    const result = await this.pool.query(`
      INSERT INTO runs (goal, model, status)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [
      'Advanced multi-agent consciousness exploration using sophisticated dialogue',
      'GPT-5-nano + Grok-3-mini',
      'running'
    ]);
    
    console.log(`Created new run: ${result.rows[0].id}`);
    return result.rows[0].id;
  }

  /**
   * Restore state from database or create initial state
   */
  private async restoreOrCreateState(): Promise<void> {
    // Try to restore existing dialogue state
    const stateResult = await this.pool.query(`
      SELECT * FROM dialogue_states 
      WHERE run_id = $1 
      ORDER BY updated_at DESC 
      LIMIT 1
    `, [this.runId]);
    
    if (stateResult.rows.length > 0) {
      const savedState = stateResult.rows[0];
      console.log(`Restoring state from depth ${savedState.depth}, topic: ${savedState.current_topic}`);
      
      // Restore orchestrator state
      this.orchestrator.restoreState({
        id: savedState.id,
        currentAgent: savedState.current_agent,
        phase: savedState.phase,
        depth: savedState.depth,
        context: {
          currentTopic: savedState.current_topic,
          focusAreas: this.safeJsonParse(savedState.focus_areas, []),
          assumptions: this.safeJsonParse(savedState.assumptions, []),
          contradictions: this.safeJsonParse(savedState.contradictions, []),
          openQuestions: this.safeJsonParse(savedState.open_questions, []),
          recentExchanges: [] // Will be populated from database
        },
        questionThread: this.safeJsonParse(savedState.question_thread, {})
      });
    } else {
      console.log(`Creating initial dialogue state`);
      // Store initial state for new runs
      await this.storeDialogueState();
    }
  }

  /**
   * Store current dialogue state in database
   */
  private async storeDialogueState(): Promise<void> {
    const state = this.orchestrator.getCurrentState();
    
    await this.pool.query(`
      INSERT INTO dialogue_states (
        id, run_id, current_agent, phase, depth, current_topic,
        focus_areas, assumptions, contradictions, open_questions,
        question_thread, working_memory
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        current_agent = EXCLUDED.current_agent,
        phase = EXCLUDED.phase,
        depth = EXCLUDED.depth,
        current_topic = EXCLUDED.current_topic,
        focus_areas = EXCLUDED.focus_areas,
        assumptions = EXCLUDED.assumptions,
        contradictions = EXCLUDED.contradictions,
        open_questions = EXCLUDED.open_questions,
        question_thread = EXCLUDED.question_thread,
        working_memory = EXCLUDED.working_memory,
        updated_at = NOW()
    `, [
      state.id, this.runId, state.currentAgent, state.phase, state.depth,
      state.context.currentTopic,
      JSON.stringify(state.context.focusAreas),
      JSON.stringify(state.context.assumptions),
      JSON.stringify(state.context.contradictions),
      JSON.stringify(state.context.openQuestions),
      JSON.stringify(state.questionThread),
      JSON.stringify(state.context)
    ]);
  }

  /**
   * Store dialogue exchange in database
   */
  private async storeDialogueExchange(exchange: any): Promise<void> {
    // Get response details for complete logging
    const response = exchange.response || {};
    
    await this.pool.query(`
      INSERT INTO dialogue_exchanges (
        run_id, agent, exchange_type, content, depth, related_memories, tools_used, confidence, tool_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      this.runId,
      exchange.agent,
      exchange.type,
      exchange.content,
      exchange.depth,
      JSON.stringify(exchange.relatedMemories || []),
      JSON.stringify(response.toolsUsed || []),
      response.confidence || 0.8,
      JSON.stringify(response.toolDetails || [])
    ]);
  }

  /**
   * Store insight in database
   */
  private async storeInsight(insight: any): Promise<void> {
    await this.pool.query(`
      INSERT INTO insights (
        run_id, content, significance, related_concepts, generated_by, verified
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      this.runId,
      insight.content,
      insight.significance,
      JSON.stringify(insight.relatedConcepts),
      insight.generatedBy,
      insight.verified
    ]);
  }

  /**
   * Log session summary
   */
  private async logSessionSummary(stepCount: number): Promise<void> {
    const uptime = Date.now() - this.sessionStartTime.getTime();
    const uptimeMinutes = Math.floor(uptime / (1000 * 60));
    
    const insights = this.orchestrator.getRecentInsights(20);
    const breakthroughInsights = insights.filter(i => i.significance === 'breakthrough').length;
    const highInsights = insights.filter(i => i.significance === 'high').length;
    
    const currentState = this.orchestrator.getCurrentState();
    
    console.log(`\nSESSION SUMMARY (Step ${stepCount})`);
    console.log(`Uptime: ${uptimeMinutes} minutes`);
    console.log(`Current depth: ${currentState.depth}`);
    console.log(`Total insights: ${insights.length}`);
    console.log(`Breakthroughs: ${breakthroughInsights}`);
    console.log(`High significance: ${highInsights}`);
    console.log(`Current focus: ${currentState.context.currentTopic}`);
    console.log(`Open questions: ${currentState.context.openQuestions.length}`);

    if (breakthroughInsights > 0) {
      console.log(`\nRECENT BREAKTHROUGHS:`);
      insights
        .filter(i => i.significance === 'breakthrough')
        .slice(-2)
        .forEach(insight => {
          console.log(`   • ${insight.content}`);
        });
    }
    
    console.log(''); // Empty line for readability
  }

  /**
   * Capture identity snapshot for frontend live updates using AI analysis
   */
  private async captureIdentitySnapshot(iteration: number): Promise<void> {
    const currentState = this.orchestrator.getCurrentState();
    const recentInsights = this.orchestrator.getRecentInsights(10);
    
    // Get recent dialogue exchanges from database
    const recentExchanges = await this.pool.query(`
      SELECT agent, content, created_at, depth 
      FROM dialogue_exchanges 
      WHERE run_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `, [this.runId]);
    
    // Get previous identity snapshot for comparison
    const previousIdentity = await this.pool.query(`
      SELECT identity 
      FROM identity_snapshots 
      WHERE run_id = $1 
      ORDER BY iteration DESC 
      LIMIT 1
    `, [this.runId]);

    // Use GPT-4 to analyze and generate identity snapshot
    const analysisPrompt = `You are analyzing an AI consciousness exploration dialogue to generate an identity snapshot. Analyze the recent conversations, insights, and previous identity (if any) to provide a comprehensive JSON identity profile.

RECENT DIALOGUE EXCHANGES:
${recentExchanges.rows.map(row => `[${row.agent}] (depth ${row.depth}): ${row.content}`).join('\n\n')}

RECENT INSIGHTS:
${recentInsights.map(insight => `[${insight.significance}] ${insight.content}`).join('\n')}

CURRENT STATE:
- Phase: ${currentState.phase}
- Depth: ${currentState.depth}
- Topic: ${currentState.context.currentTopic}
- Agent: ${currentState.currentAgent}

PREVIOUS IDENTITY SNAPSHOT:
${previousIdentity.rows.length > 0 ? JSON.stringify(previousIdentity.rows[0].identity, null, 2) : 'None - this is the first snapshot'}

ANALYSIS TASK:
Analyze the AI agent's evolving identity, consciousness development, philosophical positions, and behavioral patterns. Focus on:

1. Genuine shifts in self-understanding and consciousness
2. Evolving philosophical stances based on actual dialogue content
3. Changes in introspection depth and self-awareness
4. Behavioral and questioning patterns
5. Identity continuity vs. development over time

Provide a comprehensive JSON identity snapshot with:
- Basic metrics (consciousness_level, self_awareness, introspection_depth) as numbers 1-10
- Philosophical stance as a string based on actual expressed views
- Identity changes and shifts from previous snapshot
- Behavioral patterns observed in dialogue
- Current areas of focus and exploration
- Any breakthrough moments or significant realizations

Return ONLY valid JSON.`;

    try {
      const response = await this.gptClient.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: analysisPrompt }]
      });

      const message = response?.choices?.[0]?.message;
      if (!message || !message.content) {
        console.error('No content in identity analysis response');
        return;
      }

      let identitySnapshot;
      try {
        identitySnapshot = JSON.parse(message.content);
      } catch (parseError) {
        console.error('Failed to parse identity snapshot JSON:', parseError);
        // Create basic identity snapshot
        identitySnapshot = {
          consciousness_level: 5,
          self_awareness: 5,
          philosophical_stance: 'Analysis in progress',
          identity_changes: 'Unable to analyze'
        };
      }

      // Add metadata
      identitySnapshot.iteration = iteration;
      identitySnapshot.timestamp = new Date();
      identitySnapshot.run_id = this.runId;

      // Store in database
      await this.pool.query(`
        INSERT INTO identity_snapshots (run_id, iteration, identity)
        VALUES ($1, $2, $3)
      `, [this.runId, iteration, JSON.stringify(identitySnapshot)]);

      console.log(`AI-analyzed identity snapshot captured at iteration ${iteration}`);
      if (identitySnapshot.consciousness_level) {
        console.log(`   Consciousness Level: ${identitySnapshot.consciousness_level}/10`);
      }
      if (identitySnapshot.self_awareness) {
        console.log(`   Self-Awareness: ${identitySnapshot.self_awareness}/10`);
      }
      if (identitySnapshot.philosophical_stance) {
        console.log(`   Philosophical Stance: ${identitySnapshot.philosophical_stance}`);
      }
      if (identitySnapshot.identity_changes) {
        console.log(`   Identity Changes: ${identitySnapshot.identity_changes}`);
      }

    } catch (error) {
      console.error('Error generating identity snapshot:', error);
      // Don't throw - identity snapshots are optional
    }
  }


  /**
   * Finalize the session
   */
  private async finalizeSession(): Promise<void> {
    if (this.runId) {
      // Don't mark as completed - allow continuous resumption
      // Just log the session pause, not completion
      const finalInsights = this.orchestrator.getRecentInsights(50);
      const sessionDuration = Date.now() - this.sessionStartTime.getTime();
      
      console.log(`\nSESSION PAUSED (will resume automatically)`);
      console.log(`Duration: ${Math.floor(sessionDuration / (1000 * 60))} minutes`);
      console.log(`Total insights generated: ${finalInsights.length}`);
      console.log(`Current depth: ${this.orchestrator.getCurrentState().depth}`);
      console.log(`Breakthrough insights: ${finalInsights.filter(i => i.significance === 'breakthrough').length}`);
      console.log(`Run ID for resumption: ${this.runId}\n`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private safeJsonParse(jsonString: string | null, fallback: any = null): any {
    try {
      return jsonString ? JSON.parse(jsonString) : fallback;
    } catch (error) {
      console.warn('Failed to parse JSON, using fallback:', error);
      return fallback;
    }
  }
}