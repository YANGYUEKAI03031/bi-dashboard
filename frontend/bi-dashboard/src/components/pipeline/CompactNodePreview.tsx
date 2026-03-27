/**
 * CompactNodePreview - Mini 3-row preview shown inside node cards.
 * Shows column names with type chips and the first 3 rows of data.
 */
import React from 'react';
import { Typography, Tag, Spin } from 'antd';
import { getDataTypeInfo } from '../../utils/nodeTypeRegistry';

const { Text } = Typography;

interface CompactNodePreviewProps {
  pipelineNode: {
    type?: string;
    config?: Record<string, unknown>;
  };
  /** Columns from upstream preview (populated by useNodePreview) */
  columns?: Array<{ name: string; type?: string }>;
  /** Rows from upstream preview */
  rows?: Record<string, unknown>[];
  /** Is preview loading */
  loading?: boolean;
  /** Total row count */
  totalRows?: number;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return '{…}';
  const s = String(value);
  return s.length > 12 ? s.substring(0, 10) + '…' : s;
}

export const CompactNodePreview: React.FC<CompactNodePreviewProps> = ({
  columns = [],
  rows = [],
  loading = false,
  totalRows = 0,
}) => {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <Spin size="small" />
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
          加载中…
        </Text>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Text type="secondary" style={{ fontSize: 10 }}>
          点击节点配置后可预览数据
        </Text>
      </div>
    );
  }

  const displayCols = columns.slice(0, 5);
  const displayRows = rows.slice(0, 3);

  return (
    <div>
      {/* Column chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
        {displayCols.map(col => {
          const typeInfo = getDataTypeInfo(col.type || 'unknown');
          return (
            <Tag
              key={col.name}
              style={{
                background: typeInfo.bg,
                color: typeInfo.text,
                border: 'none',
                fontSize: 9,
                padding: '0 4px',
                lineHeight: '14px',
                height: 16,
                margin: 0,
              }}
            >
              {col.name}
            </Tag>
          );
        })}
        {columns.length > 5 && (
          <Tag style={{ fontSize: 9, padding: '0 4px', height: 16, lineHeight: '14px', margin: 0 }}>
            +{columns.length - 5}
          </Tag>
        )}
      </div>

      {/* Row preview */}
      {displayRows.length > 0 ? (
        <div style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#595959',
          background: '#fafafa',
          borderRadius: 4,
          padding: '3px 6px',
          maxHeight: 56,
          overflow: 'hidden',
        }}>
          {displayRows.map((row, i) => (
            <div key={i} style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: '16px',
            }}>
              {displayCols.map(col => (
                <span key={col.name}>
                  {formatValue(row[col.name])}
                  {col !== displayCols[displayCols.length - 1] && ' | '}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 10 }}>无数据</Text>
      )}

      {/* Row count */}
      {(totalRows > 3 || rows.length > 0) && (
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
          {totalRows > 0 ? `约 ${totalRows} 行` : `${rows.length} 行`}
          {totalRows > 3 && '（仅显示前3行）'}
        </Text>
      )}
    </div>
  );
};
