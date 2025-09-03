CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Roles for PostgREST
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_anon') THEN
      CREATE ROLE web_anon NOLOGIN;
   END IF;
END$$;

-- Original schema (keeping for compatibility)
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  goal TEXT,
  model TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_run_iter ON messages(run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS identity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  identity JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GREFLECT v2 Enhanced Memory System

-- General memories table (episodic, semantic, procedural, working)
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('episodic', 'semantic', 'procedural', 'working')),
  content JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  relevance_score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_run_type ON memories(run_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING GIN(metadata);

-- Semantic concepts table - structured philosophical knowledge
CREATE TABLE IF NOT EXISTS semantic_concepts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  definition TEXT NOT NULL,
  related_concepts JSONB DEFAULT '[]'::jsonb,
  sources JSONB DEFAULT '[]'::jsonb,
  exploration_level INTEGER DEFAULT 1 CHECK (exploration_level BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concepts_name ON semantic_concepts(name);
CREATE INDEX IF NOT EXISTS idx_concepts_exploration ON semantic_concepts(exploration_level);
CREATE INDEX IF NOT EXISTS idx_concepts_related ON semantic_concepts USING GIN(related_concepts);

-- Procedural patterns table - learned strategies and behaviors
CREATE TABLE IF NOT EXISTS procedural_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  effectiveness REAL NOT NULL CHECK (effectiveness BETWEEN 0 AND 1),
  conditions JSONB DEFAULT '[]'::jsonb,
  examples JSONB DEFAULT '[]'::jsonb,
  usage_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_name ON procedural_patterns(name);
CREATE INDEX IF NOT EXISTS idx_patterns_effectiveness ON procedural_patterns(effectiveness DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_usage ON procedural_patterns(usage_count DESC);

-- Dialogue states table - current state of philosophical inquiry
CREATE TABLE IF NOT EXISTS dialogue_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  current_agent TEXT NOT NULL CHECK (current_agent IN ('questioner', 'explorer')),
  phase TEXT NOT NULL CHECK (phase IN ('questioning', 'responding', 'reflecting', 'synthesizing')),
  depth INTEGER DEFAULT 0,
  current_topic TEXT,
  focus_areas JSONB DEFAULT '[]'::jsonb,
  assumptions JSONB DEFAULT '[]'::jsonb,
  contradictions JSONB DEFAULT '[]'::jsonb,
  open_questions JSONB DEFAULT '[]'::jsonb,
  question_thread JSONB DEFAULT '{}'::jsonb,
  working_memory JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialogue_states_run ON dialogue_states(run_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_states_agent ON dialogue_states(current_agent);
CREATE INDEX IF NOT EXISTS idx_dialogue_states_phase ON dialogue_states(phase);

-- Insights table - discoveries and realizations
CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  significance TEXT NOT NULL CHECK (significance IN ('low', 'medium', 'high', 'breakthrough')),
  related_concepts JSONB DEFAULT '[]'::jsonb,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('questioner', 'explorer', 'synthesis')),
  verified BOOLEAN DEFAULT false,
  verification_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_run ON insights(run_id);
CREATE INDEX IF NOT EXISTS idx_insights_significance ON insights(significance);
CREATE INDEX IF NOT EXISTS idx_insights_generated_by ON insights(generated_by);
CREATE INDEX IF NOT EXISTS idx_insights_verified ON insights(verified);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at DESC);

-- Dialogue exchanges table - detailed conversation history
CREATE TABLE IF NOT EXISTS dialogue_exchanges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('questioner', 'explorer')),
  exchange_type TEXT NOT NULL CHECK (exchange_type IN ('question', 'response', 'reflection', 'insight')),
  content TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  related_memories JSONB DEFAULT '[]'::jsonb,
  tools_used JSONB DEFAULT '[]'::jsonb,
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  tool_details JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exchanges_run ON dialogue_exchanges(run_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_agent ON dialogue_exchanges(agent);
CREATE INDEX IF NOT EXISTS idx_exchanges_type ON dialogue_exchanges(exchange_type);
CREATE INDEX IF NOT EXISTS idx_exchanges_created ON dialogue_exchanges(created_at DESC);

-- Framework events table - system events and debugging
CREATE TABLE IF NOT EXISTS framework_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_run ON framework_events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON framework_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON framework_events(created_at DESC);

-- Update triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_concepts_updated_at BEFORE UPDATE ON semantic_concepts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patterns_updated_at BEFORE UPDATE ON procedural_patterns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_dialogue_updated_at BEFORE UPDATE ON dialogue_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_insights_updated_at BEFORE UPDATE ON insights FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Permissions for PostgREST
GRANT USAGE ON SCHEMA public TO web_anon;
GRANT SELECT ON runs, messages, identity_snapshots TO web_anon;
GRANT SELECT ON memories, semantic_concepts, procedural_patterns, dialogue_states, insights, dialogue_exchanges, framework_events TO web_anon;

-- Views for better API access
CREATE OR REPLACE VIEW current_dialogue_state AS
SELECT DISTINCT ON (run_id) 
  run_id,
  current_agent,
  phase,
  depth,
  current_topic,
  focus_areas,
  created_at,
  updated_at
FROM dialogue_states 
ORDER BY run_id, updated_at DESC;

CREATE OR REPLACE VIEW recent_insights AS
SELECT 
  i.*,
  r.started_at as run_started
FROM insights i
JOIN runs r ON i.run_id = r.id
WHERE i.created_at > NOW() - INTERVAL '24 hours'
ORDER BY i.created_at DESC;

CREATE OR REPLACE VIEW dialogue_summary AS
SELECT 
  run_id,
  COUNT(*) as total_exchanges,
  COUNT(CASE WHEN agent = 'questioner' THEN 1 END) as questions,
  COUNT(CASE WHEN agent = 'explorer' THEN 1 END) as responses,
  MAX(depth) as max_depth,
  AVG(confidence) as avg_confidence,
  MIN(created_at) as first_exchange,
  MAX(created_at) as last_exchange
FROM dialogue_exchanges
GROUP BY run_id;

GRANT SELECT ON current_dialogue_state, recent_insights, dialogue_summary TO web_anon;