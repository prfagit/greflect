'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';

interface DialogueExchange {
  id: string;
  agent: 'questioner' | 'explorer';
  content: string;
  created_at: string;
  depth: number;
  confidence: number;
}

interface ExpandedSections {
  [key: string]: boolean;
}

interface IdentitySnapshot {
  iteration: number;
  identity: any;
  created_at: string;
}

interface RunStatus {
  id: string;
  started_at: string;
  status: string;
  goal: string;
  model: string;
}

export default function Dashboard() {
  const [exchanges, setExchanges] = useState<DialogueExchange[]>([]);
  const [currentIdentity, setCurrentIdentity] = useState<any>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [uptime, setUptime] = useState('');
  const [messageCount, setMessageCount] = useState(0);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({});
  const [expandedMessages, setExpandedMessages] = useState<ExpandedSections>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const MESSAGES_PER_PAGE = 50;

  // Fetch initial data (run status, identity, total count)
  const fetchInitialData = async () => {
    try {
      // Get latest run
      const runsRes = await fetch('/api/db/runs?order=started_at.desc&limit=1');
      const runs = await runsRes.json();
      if (runs.length > 0) {
        setRunStatus(runs[0]);
        
        // Calculate uptime from first ever message
        const firstMessageRes = await fetch('/api/db/dialogue_exchanges?order=created_at.asc&limit=1');
        const firstMessages = await firstMessageRes.json();
        const startTime = firstMessages.length > 0 ? new Date(firstMessages[0].created_at) : new Date(runs[0].started_at);
        const now = new Date();
        const uptimeMs = now.getTime() - startTime.getTime();
        const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
        setUptime(`${days}d ${hours}h ${minutes}m ${seconds}s`);

        // Get total message count
        try {
          const countRes = await fetch('/api/db/dialogue_exchanges?select=id&limit=1');
          const countData = await countRes.json();
          const totalCount = countData.length > 0 ? 'unknown' : 0; // PostgREST doesn't support exact count easily
          setTotalMessages(totalCount === 'unknown' ? 1000 : totalCount); // Rough estimate
          setMessageCount(totalCount === 'unknown' ? 1000 : totalCount);
        } catch (error) {
          console.error('Error getting message count:', error);
          setTotalMessages(0);
          setMessageCount(0);
        }

        // Get latest identity snapshot using our custom API
        const identityRes = await fetch('/api/identity');
        if (identityRes.ok) {
          const identityData = await identityRes.json();
          if (!identityData.error) {
            const identity = identityData.identity;
            setCurrentIdentity({
              ...identity,
              iteration: identityData.iteration
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
    }
  };

  // Fetch messages with pagination
  const fetchMessages = async (offsetValue: number = 0, append: boolean = false) => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      // Get ALL messages across all runs, ordered by newest first
      const exchangesRes = await fetch(
        `/api/db/dialogue_exchanges?order=created_at.desc&limit=${MESSAGES_PER_PAGE}&offset=${offsetValue}`
      );

      if (!exchangesRes.ok) {
        throw new Error(`HTTP error! status: ${exchangesRes.status}`);
      }

      const exchangesData = await exchangesRes.json();

      // Ensure we have an array
      const safeData = Array.isArray(exchangesData) ? exchangesData : [];

      if (append) {
        setExchanges(prev => [...prev, ...safeData]);
      } else {
        setExchanges(safeData);
      }

      // Check if we have more data
      setHasMore(safeData.length === MESSAGES_PER_PAGE);
      setOffset(offsetValue + MESSAGES_PER_PAGE);

    } catch (error) {
      console.error('Error fetching messages:', error);
      // Set empty array on error to prevent crashes
      if (!append) {
        setExchanges([]);
      }
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Load more messages
  const loadMore = () => {
    if (hasMore && !isLoading) {
      fetchMessages(offset, true);
    }
  };

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    if (scrolledToBottom && hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  // Add scroll event listener
  useEffect(() => {
    const chatContainer = chatContainerRef.current;
    if (chatContainer) {
      chatContainer.addEventListener('scroll', handleScroll);
      return () => chatContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    fetchInitialData();
    fetchMessages(0);

    // Set up SSE for real-time identity updates
    const identityEventSource = new EventSource('/api/sse/identity');
    identityEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const identity = data.identity;
        setCurrentIdentity({
          ...identity,
          iteration: data.iteration
        });
      } catch (error) {
        console.error('Error parsing identity SSE data:', error);
      }
    };
    identityEventSource.onerror = (error) => {
      console.error('Identity SSE error:', error);
    };

    // Check for new messages every 30 seconds (less frequent since we have pagination)
    const interval = setInterval(() => {
      fetchInitialData(); // Update run status and identity
      // Only refresh first page if user is at the top
      if (offset <= MESSAGES_PER_PAGE) {
        fetchMessages(0);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      identityEventSource.close();
    };
  }, [offset]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    });
  };

  const getAgentSymbol = (agent: string) => {
    return agent === 'questioner' ? 'Q' : 'E';
  };

  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const parseToolUsage = (content: string) => {
    const matches = [];
    let cleanContent = content;

    // Look for [Used tool_name: [JSON_ARRAY]] pattern with multiline support
    const regex = /\[Used ([^:]+): (\[[\s\S]*?\]\])\]/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      let toolResult = match[2];
      
      // Try to parse and format the JSON array
      try {
        const parsed = JSON.parse(toolResult);
        toolResult = JSON.stringify(parsed, null, 2);
      } catch (e) {
        // Keep original if not valid JSON
        console.log('Failed to parse tool result:', e);
      }
      
      matches.push({
        tool: match[1],
        result: toolResult,
        fullMatch: match[0]
      });
    }

    // Remove all tool usage from main content (including leading/trailing whitespace)
    cleanContent = content.replace(/\n\n\[Used [^:]+: \[[\s\S]*?\]\]\]/g, '').trim();
    
    return { cleanContent, toolUsages: matches };
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const toggleMessage = (messageId: string) => {
    setExpandedMessages(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  const renderIdentitySection = (content: any, key: string) => {
    if (typeof content === 'string') {
      return (
        <div style={{ color: '#ffffff', fontSize: '11px', lineHeight: '1.4' }}>
          {content}
        </div>
      );
    }

    if (typeof content === 'object' && content !== null) {
      return (
        <div style={{ fontSize: '11px' }}>
          {Object.entries(content).map(([k, v]) => (
            <div key={k} style={{ marginBottom: '8px' }}>
              <div style={{ 
                color: '#888888', 
                fontSize: '10px', 
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '2px'
              }}>
                {k.replace(/_/g, ' ')}
              </div>
              <div style={{ 
                color: '#ffffff', 
                fontSize: '11px',
                lineHeight: '1.4',
                paddingLeft: '8px',
                borderLeft: '1px solid #333333'
              }}>
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div style={{ color: '#ffffff', fontSize: '11px' }}>
        {JSON.stringify(content)}
      </div>
    );
  };

  const renderExpandableContent = (content: any, key: string, maxLength: number = 150) => {
    const isExpanded = expandedSections[key];
    
    // For objects, check if we need truncation by converting to string first
    if (typeof content === 'object' && content !== null) {
      const stringContent = JSON.stringify(content, null, 2);
      const shouldTruncate = stringContent.length > maxLength;
      
      return (
        <div>
          <div>
            {shouldTruncate && !isExpanded ? (
              <div style={{ color: '#ffffff', fontSize: '11px' }}>
                {truncateText(stringContent, maxLength)}
              </div>
            ) : (
              renderIdentitySection(content, key)
            )}
          </div>
          {shouldTruncate && (
            <button
              onClick={() => toggleSection(key)}
              style={{
                background: 'none',
                border: '1px solid #333333',
                color: '#888888',
                fontSize: '10px',
                padding: '2px 6px',
                marginTop: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              {isExpanded ? 'SHOW LESS' : 'SHOW MORE'}
            </button>
          )}
        </div>
      );
    }
    
    // For strings, check if truncation is needed
    const stringContent = String(content);
    const shouldTruncate = stringContent.length > maxLength;

    return (
      <div>
        <div>
          {shouldTruncate && !isExpanded ? (
            <div style={{ color: '#ffffff', fontSize: '11px' }}>
              {truncateText(stringContent, maxLength)}
            </div>
          ) : (
            <div style={{ color: '#ffffff', fontSize: '11px', lineHeight: '1.4' }}>
              {stringContent}
            </div>
          )}
        </div>
        {shouldTruncate && (
          <button
            onClick={() => toggleSection(key)}
            style={{
              background: 'none',
              border: '1px solid #333333',
              color: '#888888',
              fontSize: '10px',
              padding: '2px 6px',
              marginTop: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace'
            }}
          >
            {isExpanded ? 'SHOW LESS' : 'SHOW MORE'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ 
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      background: '#000000',
      color: '#ffffff',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontSize: '13px',
      lineHeight: '1.4'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #333333',
        background: '#111111'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontWeight: 'bold', color: '#ffffff' }}>
            GREFLECT
          </div>
          <div style={{ color: '#888888', fontSize: '11px' }}>
            {runStatus?.model} active • uptime: {uptime} • loaded: {exchanges.length}/{totalMessages || '?'} messages
          </div>
        </div>
      </div>

      <div className="dashboard-container" style={{ 
        display: 'flex', 
        flex: 1, 
        minHeight: 0,
        flexDirection: 'row'
      }}>
        {/* Chat Panel */}
        <div className="chat-panel" style={{
          flex: 1,
          borderRight: '1px solid #333333',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '8px 16px',
            background: '#111111',
            borderBottom: '1px solid #333333',
            color: '#cccccc',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            live exploration
          </div>
          
          <div 
            ref={chatContainerRef}
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              background: '#000000'
            }}>
            {exchanges.map((exchange, index) => {
              const { cleanContent, toolUsages } = parseToolUsage(exchange.content);
              
              return (
                <div key={exchange.id} style={{
                  marginBottom: '12px',
                  paddingLeft: '12px',
                  borderLeft: '1px solid #333333'
                }}>
                  <div style={{
                    color: '#666666',
                    fontSize: '10px',
                    marginBottom: '4px'
                  }}>
                    [{formatTimestamp(exchange.created_at)}] {getAgentSymbol(exchange.agent)} {exchange.agent.toUpperCase()} (depth: {exchange.depth})
                    {toolUsages.length > 0 && <span style={{ color: '#888888', marginLeft: '8px' }}>tools: {toolUsages.length}</span>}
                  </div>
                  
                  <div style={{
                    color: '#ffffff',
                    whiteSpace: 'pre-wrap',
                    fontSize: '12px'
                  }}>
                    {cleanContent}
                  </div>
                  
                  {/* Tool Usage Section */}
                  {toolUsages.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      {toolUsages.map((tool, toolIndex) => (
                        <div key={toolIndex} style={{
                          background: '#0a0a0a',
                          border: '1px solid #222222',
                          padding: '6px',
                          marginBottom: '4px',
                          borderRadius: '2px'
                        }}>
                          <div style={{
                            color: '#888888',
                            fontSize: '10px',
                            marginBottom: '2px',
                            textTransform: 'uppercase',
                            letterSpacing: '1px'
                          }}>
                            {tool.tool}
                            <button
                              onClick={() => toggleMessage(`${exchange.id}-${toolIndex}`)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#666666',
                                fontSize: '10px',
                                marginLeft: '8px',
                                cursor: 'pointer'
                              }}
                            >
                              {expandedMessages[`${exchange.id}-${toolIndex}`] ? '▼' : '▶'}
                            </button>
                          </div>
                          {expandedMessages[`${exchange.id}-${toolIndex}`] && (
                            <div style={{
                              fontSize: '10px',
                              fontFamily: 'monospace',
                              color: '#cccccc',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '200px',
                              overflowY: 'auto'
                            }}>
                              {tool.result.length > 300 ? 
                                `${tool.result.substring(0, 300)}...` : 
                                tool.result
                              }
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Loading indicator */}
            {isLoading && (
              <div style={{ 
                color: '#666666', 
                textAlign: 'center', 
                padding: '16px',
                fontSize: '11px'
              }}>
                Loading more messages...
              </div>
            )}

            {/* Load more button */}
            {!isLoading && hasMore && exchanges.length > 0 && (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <button
                  onClick={loadMore}
                  style={{
                    background: 'none',
                    border: '1px solid #333333',
                    color: '#888888',
                    fontSize: '11px',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontFamily: 'monospace'
                  }}
                >
                  LOAD MORE ({(totalMessages || 0) - exchanges.length} remaining)
                </button>
              </div>
            )}

            {/* No more messages */}
            {!hasMore && exchanges.length > 0 && (
              <div style={{ 
                color: '#444444', 
                textAlign: 'center', 
                padding: '16px',
                fontSize: '10px'
              }}>
                — END OF CONVERSATION HISTORY —
              </div>
            )}

            {exchanges.length === 0 && !isLoading && (
              <div style={{ color: '#666666', textAlign: 'center', marginTop: '50px' }}>
                Waiting for consciousness exploration to begin...
              </div>
            )}
          </div>
        </div>

        {/* Identity Panel */}
        <div className="identity-panel" style={{
          width: '350px',
          minWidth: '300px',
          background: '#000000',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '8px 16px',
            background: '#111111',
            borderBottom: '1px solid #333333',
            color: '#cccccc',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            identity matrix
          </div>
          
          <div style={{ padding: '16px', flex: 1 }}>
            {currentIdentity ? (
              <>
                {/* Consciousness Level */}
                {currentIdentity.basicMetrics?.consciousnessLevel !== undefined && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>consciousness level</div>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      color: '#ffffff'
                    }}>{currentIdentity.basicMetrics.consciousnessLevel}/10</div>
                  </div>
                )}

                {/* Self Awareness */}
                {currentIdentity.basicMetrics?.selfAwareness !== undefined && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>self awareness</div>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      color: '#ffffff'
                    }}>{currentIdentity.basicMetrics.selfAwareness}/10</div>
                  </div>
                )}

                <div style={{ borderBottom: '1px solid #222222', margin: '12px 0' }}></div>

                {/* Philosophical Stance */}
                {currentIdentity.philosophicalStance && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>philosophical stance</div>
                    {renderExpandableContent(currentIdentity.philosophicalStance, 'philosophical', 150)}
                  </div>
                )}

                {/* Current Focus */}
                {currentIdentity.currentFocus && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>current focus</div>
                    {renderExpandableContent(currentIdentity.currentFocus, 'focus', 120)}
                  </div>
                )}

                <div style={{ borderBottom: '1px solid #222222', margin: '12px 0' }}></div>

                {/* Identity Changes */}
                {currentIdentity.identityChanges && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>recent changes</div>
                    {renderExpandableContent(currentIdentity.identityChanges, 'changes', 150)}
                  </div>
                )}

                {/* Breakthrough Moments */}
                {currentIdentity.breakthroughMoments && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      color: '#666666',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '4px'
                    }}>breakthrough moments</div>
                    {renderExpandableContent(currentIdentity.breakthroughMoments, 'breakthroughs', 200)}
                  </div>
                )}

              </>
            ) : (
              <div style={{ color: '#666666', textAlign: 'center', marginTop: '50px' }}>
                Waiting for identity analysis...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 16px',
        background: '#111111',
        borderTop: '1px solid #333333',
        textAlign: 'center'
      }}>
        <div style={{
          color: '#888888',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%'
        }}>
          <span>GREFLECT • {runStatus?.status || 'initializing'}</span>
          <Link href="/logs" style={{ color: '#888888', textDecoration: 'none' }}>
            RAW LOGS →
          </Link>
        </div>
      </div>
    </div>
  );
}