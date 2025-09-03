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

export default function Logs() {
  const [exchanges, setExchanges] = useState<DialogueExchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const MESSAGES_PER_PAGE = 100; // More per page for raw logs

  const fetchLogs = async (offsetValue: number = 0, append: boolean = false) => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      // Get ALL exchanges from all runs, ordered chronologically
      const exchangesRes = await fetch(
        `/api/db/dialogue_exchanges?order=created_at.desc&limit=${MESSAGES_PER_PAGE}&offset=${offsetValue}`
      );
      const exchangesData = await exchangesRes.json();
      
      if (append) {
        setExchanges(prev => [...prev, ...exchangesData]);
      } else {
        setExchanges(exchangesData);
        // Get total count with exact count preference
        const countRes = await fetch('/api/db/dialogue_exchanges', { 
          method: 'HEAD',
          headers: {
            'Prefer': 'count=exact'
          }
        });
        const contentRange = countRes.headers.get('Content-Range') || '0-0/0';
        const totalCount = parseInt(contentRange.split('/')[1] || '0');
        setTotalMessages(totalCount);
      }
      
      setHasMore(exchangesData.length === MESSAGES_PER_PAGE);
      setOffset(offsetValue + MESSAGES_PER_PAGE);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching logs:', error);
      setLoading(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = () => {
    if (hasMore && !isLoading) {
      fetchLogs(offset, true);
    }
  };

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    if (scrolledToBottom && hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  useEffect(() => {
    const logsContainer = logsContainerRef.current;
    if (logsContainer) {
      logsContainer.addEventListener('scroll', handleScroll);
      return () => logsContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    fetchLogs(0);
    // Less frequent refresh for logs
    const interval = setInterval(() => {
      if (offset <= MESSAGES_PER_PAGE) {
        fetchLogs(0); // Only refresh first page
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ 
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      background: '#000000',
      color: '#ffffff',
      minHeight: '100vh',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontSize: '12px',
      lineHeight: '1.4',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div className="logs-header" style={{
        padding: '12px 16px',
        borderBottom: '1px solid #333333',
        background: '#111111',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ fontWeight: 'bold', color: '#ffffff' }}>
          GREFLECT • RAW LOGS ({exchanges.length}/{totalMessages})
        </div>
        <Link href="/dashboard" style={{ color: '#888888', textDecoration: 'none', fontSize: '11px' }}>
          ← BACK TO DASHBOARD
        </Link>
      </div>

      {/* Raw logs */}
      <div 
        ref={logsContainerRef}
        className="logs-container" 
        style={{
          flex: 1,
          padding: '8px',
          overflowY: 'auto',
          background: '#000000',
          fontFamily: 'monospace',
          fontSize: '10px'
        }}>
        {loading ? (
          <div style={{ color: '#666666', textAlign: 'center', marginTop: '50px' }}>
            Loading logs...
          </div>
        ) : exchanges.length === 0 ? (
          <div style={{ color: '#666666', textAlign: 'center', marginTop: '50px' }}>
            No logs found.
          </div>
        ) : (
          exchanges.map((exchange, index) => (
            <div key={exchange.id} className="raw-log-entry" style={{ 
              marginBottom: '4px', 
              fontSize: '10px',
              fontFamily: 'monospace',
              lineHeight: '1.3',
              padding: '4px',
              borderBottom: '1px solid #111111'
            }}>
              <div style={{ 
                color: '#ffffff', 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                overflowWrap: 'break-word'
              }}>
                {JSON.stringify(exchange, null, 2)}
              </div>
            </div>
          ))
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ 
            color: '#666666', 
            textAlign: 'center', 
            padding: '16px',
            fontSize: '10px'
          }}>
            Loading more logs...
          </div>
        )}

        {/* Load more button */}
        {!isLoading && hasMore && exchanges.length > 0 && (
          <div style={{ textAlign: 'center', padding: '8px' }}>
            <button
              onClick={loadMore}
              style={{
                background: 'none',
                border: '1px solid #333333',
                color: '#666666',
                fontSize: '9px',
                padding: '4px 8px',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              LOAD MORE ({totalMessages - exchanges.length} remaining)
            </button>
          </div>
        )}

        {/* End of logs */}
        {!hasMore && exchanges.length > 0 && (
          <div style={{ 
            color: '#333333', 
            textAlign: 'center', 
            padding: '16px',
            fontSize: '9px'
          }}>
            — END OF LOGS —
          </div>
        )}
      </div>
    </div>
  );
}
