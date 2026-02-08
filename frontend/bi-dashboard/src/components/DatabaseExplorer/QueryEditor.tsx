// src/components/DatabaseExplorer/QueryEditor.tsx
import React from 'react';

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  loading: boolean;
}

export const QueryEditor: React.FC<QueryEditorProps> = ({
  value,
  onChange,
  onExecute,
  loading
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      onExecute();
    }
  };

  return (
    <div className="query-editor">
      <div className="editor-header">
        <h3>SQL查询编辑器</h3>
        <div className="editor-help">
          <span>Ctrl/Cmd + Enter 执行查询</span>
        </div>
      </div>
      
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入SQL查询语句..."
        className="sql-editor"
        disabled={loading}
      />
      
      <div className="editor-footer">
        <button 
          onClick={onExecute}
          disabled={loading || !value.trim()}
          className="execute-btn"
        >
          {loading ? '执行中...' : '执行查询'}
        </button>
      </div>
    </div>
  );
};