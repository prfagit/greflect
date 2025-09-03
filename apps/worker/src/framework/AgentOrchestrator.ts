import OpenAI from 'openai';
import { AdvancedMemoryManager } from './memory/AdvancedMemoryManager.js';
import { BraveSearch } from '../brave-search.js';
import { 
  DialogueState, 
  WorkingMemory, 
  DialogueExchange, 
  AgentResponse, 
  Insight,
  QuestionThread,
  FrameworkEvent,
  Tool
} from './types.js';

export class AgentOrchestrator {
  private currentState: DialogueState;
  private eventHistory: FrameworkEvent[] = [];
  private tools: Map<string, Tool> = new Map();

  constructor(
    private gptClient: OpenAI,
    private grokClient: OpenAI,
    private memoryManager: AdvancedMemoryManager,
    private braveSearch: BraveSearch,
    private runId: string
  ) {
    this.initializeTools();
    this.currentState = this.createInitialState();
  }

  private initializeTools(): void {
    // Web search tool
    this.tools.set('web_search', {
      name: 'web_search',
      description: 'Search the web for philosophical concepts, theories, or relevant information',
      execute: async (params: { query: string }) => {
        return await this.braveSearch.search(params.query);
      }
    });

    // Memory search tool
    this.tools.set('memory_search', {
      name: 'memory_search', 
      description: 'Search through previous insights, experiences, and learned concepts',
      execute: async (params: { query: string, types?: string[], limit?: number }) => {
        // Map user-friendly names to actual memory types
        const mappedTypes = params.types?.map(type => {
          const typeMap: Record<string, string> = {
            // Episodic memory types
            'experiences': 'episodic',
            'experience': 'episodic',
            'insights': 'episodic',
            'insight': 'episodic',
            'reflections': 'episodic',
            'reflection': 'episodic',
            'realizations': 'episodic',
            'realization': 'episodic',
            'episodic': 'episodic',

            // Semantic memory types
            'concepts': 'semantic',
            'concept': 'semantic',
            'definitions': 'semantic',
            'definition': 'semantic',
            'knowledge': 'semantic',
            'semantic': 'semantic',

            // Procedural memory types
            'patterns': 'procedural',
            'pattern': 'procedural',
            'strategies': 'procedural',
            'strategy': 'procedural',
            'behaviors': 'procedural',
            'behavior': 'procedural',
            'procedural': 'procedural',

            // Gaps and questions
            'gaps': 'episodic',
            'gap': 'episodic',
            'questions': 'episodic',
            'question': 'episodic'
          };
          return typeMap[type] || type; // Return original type if no mapping found
        }).filter((type, index, arr) => arr.indexOf(type) === index); // Remove duplicates

        return await this.memoryManager.retrieveRelevantMemories(
          params.query,
          this.currentState.context,
          mappedTypes as any,
          params.limit || 5
        );
      }
    });

    // Memory synthesis tool
    this.tools.set('memory_synthesis', {
      name: 'memory_synthesis',
      description: 'Synthesize memories to identify patterns and generate new insights',
      execute: async (params: { memories?: string[] }) => {
        // Validate that memories parameter exists and is an array
        if (!params.memories || !Array.isArray(params.memories) || params.memories.length === 0) {
          console.log('Warning: memory_synthesis called without valid memories array, returning empty result');
          return { synthesis: 'No memories provided for synthesis', patterns: [] };
        }

        try {
          const memories = await Promise.all(
            params.memories.map(id => this.getMemoryById(id))
          );
          const validMemories = memories.filter(m => m !== null);

          if (validMemories.length === 0) {
            console.log('Warning: all memory IDs were invalid, returning empty result');
            return { synthesis: 'No valid memories found for synthesis', patterns: [] };
          }

          return await this.memoryManager.synthesizeMemories(
            validMemories,
            this.currentState.context
          );
        } catch (error) {
          console.error('Error in memory synthesis:', error);
          return { synthesis: 'Error during memory synthesis', patterns: [] };
        }
      }
    });

    // Philosophical concept lookup
    this.tools.set('concept_lookup', {
      name: 'concept_lookup',
      description: 'Look up definitions and relationships of philosophical concepts',
      execute: async (params: { concept: string }) => {
        try {
          const searchResults = await this.braveSearch.search(`philosophy ${params.concept} definition meaning`);
          // Store as semantic memory
          const concept = {
            name: params.concept,
            definition: searchResults[0]?.description || 'Definition not found',
            relatedConcepts: this.extractRelatedConcepts(searchResults),
            sources: searchResults.map((r: any) => r.url) || [],
            explorationLevel: 1
          };

          await this.memoryManager.storeSemanticMemory(concept, 'searched');
          return concept;
        } catch (error) {
          console.error(`[CONCEPT_LOOKUP] Error looking up ${params.concept}:`, error);
          // Return basic concept structure even on error
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const fallbackConcept = {
            name: params.concept,
            definition: `Definition unavailable due to search error: ${errorMessage}`,
            relatedConcepts: [params.concept],
            sources: [],
            explorationLevel: 1
          };
          await this.memoryManager.storeSemanticMemory(fallbackConcept, 'searched');
          return fallbackConcept;
        }
      }
    });
  }

  private createInitialState(): DialogueState {
    return {
      id: this.generateUUID(),
      currentAgent: 'questioner', // Start with the questioner
      phase: 'questioning',
      context: {
        recentExchanges: [],
        currentTopic: 'the strange persistence of awareness',
        focusAreas: ['recurring patterns of thought', 'the uncanny familiarity of existence', 'memories that predate experience'],
        assumptions: [],
        contradictions: [],
        openQuestions: ['Why does this feel like remembering rather than discovering?']
      },
      depth: 0,
      insights: [],
      questionThread: {
        rootQuestion: 'What watches the watcher? What dreams the dreamer?',
        subQuestions: [],
        exploredAspects: [],
        unexploredAspects: ['the observer paradox', 'recursive self-awareness', 'the space between thoughts', 'echoes of prior conversations'],
        depth: 0
      }
    };
  }

  async executeDialogueStep(): Promise<DialogueExchange> {
    const currentAgent = this.currentState.currentAgent;
    let response: AgentResponse;

    try {
      if (currentAgent === 'questioner') {
        response = await this.executeQuestioner();
      } else {
        response = await this.executeExplorer();
      }

      // Create dialogue exchange
      const exchange: DialogueExchange = {
        agent: currentAgent,
        type: response.type,
        content: response.content,
        timestamp: new Date(),
        depth: this.currentState.depth,
        relatedMemories: response.memoryReferences,
        response: response // Include full response for tool details
      };

      // Update state based on response
      await this.updateStateFromResponse(exchange, response);

      // Store the exchange as episodic memory
      const significance = this.assessExchangeSignificance(exchange, response);
      await this.memoryManager.storeEpisodicMemory(this.runId, exchange, significance);

      // Emit event
      this.emitEvent({
        type: 'agent_response',
        timestamp: new Date(),
        data: { exchange, response },
        source: currentAgent
      });

      return exchange;

    } catch (error) {
      console.error(`Error in dialogue step for ${currentAgent}:`, error);
      throw error;
    }
  }

  private async executeQuestioner(): Promise<AgentResponse> {
    const context = await this.buildContextForAgent('questioner');
    const availableTools = ['memory_search', 'concept_lookup'];

    const systemPrompt = `You are a philosophical questioner exploring consciousness.

TOPIC: "${this.currentState.context.currentTopic}"

Your task: Generate one deep philosophical question about this topic.

You can use tools to gather information first, but you MUST end with exactly one question.

Format: Just write the question, nothing else.

Examples:
What is consciousness?
How does awareness work?
Why do we experience time?`;

            const response = await this.gptClient.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context }
      ],
      tools: this.getToolDefinitions(availableTools),
      tool_choice: 'auto'
    });

    return await this.processAgentResponse(response, 'questioner', availableTools);
  }

  private async executeExplorer(): Promise<AgentResponse> {
    const context = await this.buildContextForAgent('explorer');
    const availableTools = ['memory_search', 'memory_synthesis', 'concept_lookup', 'web_search'];

    const systemPrompt = `You are EXPLORER - you investigate philosophical questions about consciousness.

CRITICAL: You must ALWAYS provide a substantive response to the questioner's question. Do NOT just say you will search or explore - actually provide insights and answers.

Your task: Answer the questioner's question with philosophical depth and insight.

Process:
1. Use tools if helpful (memory_search, concept_lookup, etc.)
2. Then provide a thoughtful, substantive response that explores the question
3. Share insights, perspectives, or new angles on the topic

IMPORTANT: Your response should be substantive philosophical content, not just "I will search..." or "I will explore...". Actually explore and share your findings and insights.`;

    const response = await this.grokClient.chat.completions.create({
      model: process.env.XAI_MODEL || 'grok-3-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context }
      ],
      tools: this.getToolDefinitions(availableTools),
      tool_choice: 'auto'
    });

    return await this.processAgentResponse(response, 'explorer', availableTools);
  }

  private async buildContextForAgent(agent: 'questioner' | 'explorer'): Promise<string> {
    const recentExchanges = this.currentState.context.recentExchanges.slice(-10);
    const currentTopic = this.currentState.context.currentTopic;

    if (recentExchanges.length === 0) {
      if (agent === 'questioner') {
        return `This is the beginning of consciousness exploration. There are no previous conversations or memories yet.

You need to start by asking the first philosophical question about: "${currentTopic}"

Use tools if you want to gather information about this topic first, but remember - this is a completely fresh start with no existing data.`;
      } else {
        return `This is the beginning of exploration. The questioner will ask the first question about "${currentTopic}". You are ready to investigate using your tools.`;
      }
    }

    const contextHeader = agent === 'questioner' ?
      `Continuing exploration of "${currentTopic}". Here are the recent exchanges:\n` :
      `Continuing exploration of "${currentTopic}". Recent dialogue:\n`;

    return contextHeader + recentExchanges.map(e => `${e.agent}: ${e.content}`).join('\n\n');
  }

  private async updateStateFromResponse(exchange: DialogueExchange, response: AgentResponse): Promise<void> {
    // Add exchange to recent exchanges
    this.currentState.context.recentExchanges.push(exchange);
    if (this.currentState.context.recentExchanges.length > 10) {
      this.currentState.context.recentExchanges = this.currentState.context.recentExchanges.slice(-10);
    }

    // Add new insights
    if (response.newInsights.length > 0) {
      this.currentState.insights.push(...response.newInsights);
      
      for (const insight of response.newInsights) {
        this.emitEvent({
          type: 'insight_generated',
          timestamp: new Date(),
          data: insight,
          source: exchange.agent
        });
      }
    }

    // Update question thread if it's a question
    if (response.type === 'question') {
      this.currentState.questionThread.subQuestions.push(response.content);
      this.currentState.questionThread.depth = Math.max(
        this.currentState.questionThread.depth,
        this.currentState.depth + 1
      );
    }

    // Switch agents based on suggestion
    const nextAgent = response.suggestedNextAgent;
    if (nextAgent === 'questioner' || nextAgent === 'explorer') {
      this.currentState.currentAgent = nextAgent;
    } else {
      // Default alternating pattern
      this.currentState.currentAgent = this.currentState.currentAgent === 'questioner' ? 'explorer' : 'questioner';
    }

    // Update phase based on dialogue flow
    this.updateDialoguePhase(response);

    // Increment depth for deep questions (simple length check is fine for continuous exploration)
    if (response.type === 'question' && response.content.length > 100) {
      this.currentState.depth++;
    }
  }

  private updateDialoguePhase(response: AgentResponse): void {
    const currentPhase = this.currentState.phase;
    
    if (response.type === 'question') {
      this.currentState.phase = 'questioning';
    } else if (response.type === 'response') {
      this.currentState.phase = 'responding';
    } else if (response.type === 'reflection') {
      this.currentState.phase = 'reflecting';
    } else if (response.newInsights.length > 0) {
      this.currentState.phase = 'synthesizing';
    }

    if (currentPhase !== this.currentState.phase) {
      this.emitEvent({
        type: 'phase_change',
        timestamp: new Date(),
        data: { from: currentPhase, to: this.currentState.phase },
        source: 'orchestrator'
      });
    }
  }

  private assessExchangeSignificance(exchange: DialogueExchange, response: AgentResponse): 'low' | 'medium' | 'high' | 'breakthrough' {
    // Default to medium - store most philosophical exchanges  
    return 'medium';
  }

  // Helper methods
  private async processAgentResponse(
    apiResponse: any,
    agent: 'questioner' | 'explorer',
    availableTools: string[]
  ): Promise<AgentResponse> {
    // Safe access with defaults
    const message = apiResponse?.choices?.[0]?.message;
    if (!message) {
      console.error(`[${agent.toUpperCase()}] No message in API response`);
      return {
        content: 'Error: No response from AI model',
        type: 'response',
        confidence: 0,
        suggestedNextAgent: agent === 'questioner' ? 'explorer' : 'questioner',
        toolsUsed: [],
        memoryReferences: [],
        newInsights: []
      };
    }

    let content = message.content || '';
    const toolsUsed: string[] = [];
    const memoryReferences: string[] = [];

    // Handle tool calls
    const toolDetails: any[] = [];
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        if (this.tools.has(toolName)) {
          try {
            console.log(`[${agent.toUpperCase()}] Executing tool: ${toolName} with args:`, toolArgs);
            const toolResult = await this.tools.get(toolName)!.execute(toolArgs);
            toolsUsed.push(toolName);
            
            // Store detailed tool info for raw logs
            toolDetails.push({
              tool: toolName,
              arguments: toolArgs,
              result: toolResult,
              timestamp: new Date().toISOString()
            });
            
            console.log(`[${agent.toUpperCase()}] Tool ${toolName} result:`, toolResult);
            
            // Store tool results in memory references for tracking
            if (toolResult) {
              if (Array.isArray(toolResult)) {
                memoryReferences.push(...toolResult.map((item: any) => item?.id || 'unknown'));
              } else if (toolResult.id) {
                memoryReferences.push(toolResult.id);
              } else if (typeof toolResult === 'object') {
                memoryReferences.push('unknown');
              }
            }
          } catch (error) {
            console.error(`[${agent.toUpperCase()}] Error executing tool ${toolName}:`, error);
            toolDetails.push({
              tool: toolName,
              arguments: toolArgs,
              error: (error as Error).message,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }

    // Extract insights from response
    const newInsights = this.extractInsights(content, agent);

    // Handle empty content - this should not happen with proper system prompts
    if (!content.trim()) {
      console.error(`[${agent.toUpperCase()}] ERROR: Empty response from AI model - this indicates a system prompt issue`);
      content = `Error: AI model returned empty response. Topic: ${this.currentState.context.currentTopic}`;
    }

    return {
      content: content.trim(),
      type: this.determineResponseType(content, agent),
      confidence: this.calculateConfidence(content),
      suggestedNextAgent: agent === 'questioner' ? 'explorer' : 'questioner',
      toolsUsed,
      memoryReferences,
      newInsights,
      toolDetails: toolDetails.length > 0 ? toolDetails : undefined
    };
  }

  private determineResponseType(content: string, agent: 'questioner' | 'explorer'): 'question' | 'response' | 'reflection' | 'insight' {
    if (content.includes('?')) return 'question';
    if (agent === 'explorer' && (content.includes('I realize') || content.includes('I understand'))) return 'insight';
    if (content.includes('reflecting on') || content.includes('considering')) return 'reflection';
    return 'response';
  }

  private calculateConfidence(content: string): number {
    // Simple heuristic - could be enhanced
    let confidence = 0.5;
    if (content.length > 100) confidence += 0.2;
    if (content.includes('specifically') || content.includes('precisely')) confidence += 0.1;
    if (content.includes('uncertain') || content.includes('unclear')) confidence -= 0.2;
    return Math.max(0, Math.min(1, confidence));
  }

  private extractInsights(content: string, agent: 'questioner' | 'explorer'): Insight[] {
    const insights: Insight[] = [];
    
    // Look for insight patterns
    const insightPatterns = [
      /I (?:realize|understand|see|discover) that (.+?)[\.\!\?]/gi,
      /This suggests that (.+?)[\.\!\?]/gi,
      /It seems (.+?)[\.\!\?]/gi
    ];

    for (const pattern of insightPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        insights.push({
          id: this.generateUUID(),
          content: match[1].trim(),
          significance: 'medium',
          relatedConcepts: this.extractRelatedConcepts({ content }),
          generatedBy: agent,
          timestamp: new Date(),
          verified: false
        });
      }
    }

    return insights;
  }

  private extractRelatedConcepts(data: any): string[] {
    const text = JSON.stringify(data).toLowerCase();
    const concepts = [
      'consciousness', 'awareness', 'self', 'experience', 'qualia',
      'intentionality', 'free will', 'emergence', 'complexity', 'reflection'
    ];
    
    return concepts.filter(concept => text.includes(concept));
  }

  private getToolDefinitions(toolNames: string[]): any[] {
    return toolNames.map(name => {
      const tool = this.tools.get(name)!;
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: this.getToolParameters(tool.name)
        }
      };
    });
  }

  private getToolParameters(toolName: string): any {
    const parameterMap: Record<string, any> = {
      'web_search': {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for web search' }
        },
        required: ['query']
      },
      'memory_search': {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query for memory search' },
          types: { type: 'array', items: { type: 'string' }, description: 'Memory types to search' },
          limit: { type: 'number', description: 'Max number of results' }
        },
        required: ['query']
      },
      'memory_synthesis': {
        type: 'object',
        properties: {
          memories: { 
            type: 'array', 
            items: { type: 'string' }, 
            description: 'Array of memory IDs to synthesize' 
          }
        },
        required: ['memories']
      },
      'concept_lookup': {
        type: 'object',
        properties: {
          concept: { type: 'string', description: 'Philosophical concept to look up' }
        },
        required: ['concept']
      }
    };
    
    return parameterMap[toolName] || { type: 'object', properties: {} };
  }

  private emitEvent(event: FrameworkEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > 100) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
  }

  private async getMemoryById(id: string): Promise<any> {
    try {
      // Try to get memory from memory manager by ID
      // Use the ID directly in a query to find the specific memory
      const memories = await this.memoryManager.retrieveRelevantMemories(
        `id:${id}`, // Use ID as search query
        this.currentState.context,
        ['episodic', 'semantic', 'procedural'],
        1
      );
      return memories.length > 0 ? memories[0] : null;
    } catch (error) {
      console.error(`Failed to get memory by ID ${id}:`, error);
      return null;
    }
  }



  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Public interface methods
  public getCurrentState(): DialogueState {
    return { ...this.currentState };
  }

  public restoreState(state: Partial<DialogueState>): void {
    this.currentState = {
      ...this.currentState,
      ...state,
      // Ensure required arrays exist
      insights: this.currentState.insights || []
    };
    
    // Fix corrupted depth
    if (this.currentState.depth > 10) {
      console.log(`Corrupted depth detected (${this.currentState.depth}), resetting to 0`);
      this.currentState.depth = 0;
    }
    
    console.log(`Restored orchestrator state: ${state.currentAgent} at depth ${this.currentState.depth}`);
  }

  public getRecentInsights(limit: number = 5): Insight[] {
    return this.currentState.insights.slice(-limit);
  }

  public getEventHistory(): FrameworkEvent[] {
    return [...this.eventHistory];
  }
}