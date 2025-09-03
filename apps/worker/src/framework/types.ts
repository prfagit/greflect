import OpenAI from 'openai';

// Core agent framework types
export interface AgentConfig {
  name: string;
  role: 'questioner' | 'explorer';
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface Tool {
  name: string;
  description: string;
  execute: (params: any) => Promise<any>;
}

export interface Memory {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  content: any;
  timestamp: Date;
  relevanceScore?: number;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface DialogueState {
  id: string;
  currentAgent: 'questioner' | 'explorer';
  phase: 'questioning' | 'responding' | 'reflecting' | 'synthesizing';
  context: WorkingMemory;
  depth: number; // How deep we've gone in philosophical inquiry
  insights: Insight[];
  questionThread: QuestionThread;
}

export interface WorkingMemory {
  recentExchanges: DialogueExchange[];
  currentTopic: string;
  focusAreas: string[];
  assumptions: string[];
  contradictions: string[];
  openQuestions: string[];
}

export interface DialogueExchange {
  agent: 'questioner' | 'explorer';
  type: 'question' | 'response' | 'reflection' | 'insight';
  content: string;
  timestamp: Date;
  depth: number;
  relatedMemories: string[];
  response?: AgentResponse; // Full response data for tool details
}

export interface QuestionThread {
  rootQuestion: string;
  subQuestions: string[];
  exploredAspects: string[];
  unexploredAspects: string[];
  depth: number;
}

export interface Insight {
  id: string;
  content: string;
  significance: 'low' | 'medium' | 'high' | 'breakthrough';
  relatedConcepts: string[];
  generatedBy: 'questioner' | 'explorer' | 'synthesis';
  timestamp: Date;
  verified: boolean;
}

export interface AgentResponse {
  content: string;
  type: 'question' | 'response' | 'reflection' | 'insight';
  confidence: number;
  suggestedNextAgent: 'questioner' | 'explorer' | 'synthesis';
  toolsUsed: string[];
  memoryReferences: string[];
  newInsights: Insight[];
  toolDetails?: any[]; // Detailed tool execution info for raw logs
}

export interface PhilosophicalConcept {
  name: string;
  definition: string;
  relatedConcepts: string[];
  sources: string[];
  explorationLevel: number; // 0-10, how deeply we've explored this
}

// Agent capabilities
export interface AgentCapabilities {
  canQuestion: boolean;
  canExplore: boolean;
  canSynthesize: boolean;
  canSearch: boolean;
  canRemember: boolean;
  specializations: string[];
}

// Framework events
export interface FrameworkEvent {
  type: 'agent_response' | 'insight_generated' | 'memory_stored' | 'phase_change';
  timestamp: Date;
  data: any;
  source: string;
}