/**
 * NodePreviewTable - Renders preview data for a pipeline node.
 * 画布底部浏览区与节点内紧凑预览共用。
 * Supports both compact (3-row) and full paginated modes.
 */
import React, { useState } from 'react';
import { Table, Typography, Tag, Tooltip, Button, Space } from 'antd';
import { LeftOutlined, RightOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getDataTypeInfo } from '../../utils/nodeTypeRegistry';
import type { PreviewData } from '../../hooks/useNodePreview';

const { Text } = Typography;

interface NodePreviewTableProps {
  /** Preview data returned from useNodePreview */
  data: PreviewData;
  /** Show compact 3-row version (for inside node cards) */
  compact?: boolean;
  /** Page size for full mode */
  pageSize?: number;
  /** Whether to show pagination controls */
  showPagination?: boolean;
  /** Zebra striping (画布底部浏览模式) */
  striped?: boolean;
  /** 仅显示这些列（顺序与数组一致）；不传则显示全部 */
  displayColumnKeys?: string[];
}

function formatCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>null</span>;
  }
  if (typeof value === 'boolean') {
    return <Tag color={value ? 'green' : 'red'} style={{ fontSize: 11 }}>{value.toString()}</Tag>;
  }
  if (typeof value === 'object') {
    return <Tooltip title={JSON.stringify(value)}><code style={{ fontSize: 11 }}>{'{...}'}</code></Tooltip>;
  }
  return String(value);
}

export const NodePreviewTable: React.FC<NodePreviewTableProps> = ({
  data,
  compact = false,
  pageSize = 10,
  showPagination = true,
  striped = false,
  displayColumnKeys,
}) => {
  const [page, setPage] = useState(1);

  const columnsOrdered = React.useMemo(() => {
    if (!data?.columns?.length) return [];
    if (!displayColumnKeys?.length) return data.columns;
    return displayColumnKeys.filter((c) => data.columns.includes(c));
  }, [data, displayColumnKeys]);

  if (!data || data.columns.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: '#9CA3AF' }}>
        暂无数据
      </div>
    );
  }

  const displayRows = compact ? data.rows.slice(0, 3) : data.rows;
  const maxPage = Math.max(1, Math.ceil(data.rows.length / pageSize));
  const startIdx = (page - 1) * pageSize;
  const pagedRows = compact ? displayRows : data.rows.slice(startIdx, startIdx + pageSize);

  const colList = columnsOrdered.length ? columnsOrdered : data.columns;

  const columns: ColumnsType<Record<string, unknown>> = colList.map(col => ({
    title: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {data.columnTypes && data.columnTypes[data.columns.indexOf(col)] !== undefined && (
          (() => {
            const ti = data.columns.indexOf(col);
            const typeInfo = getDataTypeInfo(data.columnTypes?.[ti] || '');
            return (
              <Tooltip title={data.columnTypes?.[ti]}>
                <Tag
                  style={{
                    background: typeInfo.bg,
                    color: typeInfo.text,
                    border: 'none',
                    fontSize: 10,
                    padding: '0 4px',
                    lineHeight: '16px',
                    height: 16,
                    marginRight: 4,
                  }}
                >
                  {typeInfo.label}
                </Tag>
              </Tooltip>
            );
          })()
        )}
        <span style={{ fontSize: 12 }}>{col}</span>
      </div>
    ),
    dataIndex: col,
    key: col,
    width: 140,
    ellipsis: !compact,
    render: (value: unknown) => formatCellValue(value),
  }));

  return (
    <div>
      {compact && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {data.total > 3 ? `约 ${data.total} 行` : `共 ${data.total} 行`}
            {data.hasMore && '（仅显示前 3 行）'}
          </Text>
        </div>
      )}
      <Table
        size="small"
        columns={columns}
        dataSource={pagedRows.map((row, i) => ({ ...row, key: startIdx + i }))}
        pagination={!compact && showPagination ? false : false}
        scroll={{ x: colList.length * 140 }}
        style={{
          borderRadius: 6,
          border: '1px solid #f0f0f0',
        }}
        rowClassName={(_, index) => {
          const base = 'preview-row';
          if (striped && index % 2 === 1) return `${base} preview-row--stripe`;
          return base;
        }}
      />
      {!compact && showPagination && data.rows.length > pageSize && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            第 {startIdx + 1}–{Math.min(startIdx + pageSize, data.rows.length)} 条，共 {data.rows.length} 条
            {data.hasMore && `（共约 ${data.total} 行）`}
          </Text>
          <Space size={4}>
            <Button
              size="small"
              icon={<LeftOutlined />}
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            />
            <Text style={{ fontSize: 12 }}>{page} / {maxPage}</Text>
            <Button
              size="small"
              icon={<RightOutlined />}
              disabled={page >= maxPage}
              onClick={() => setPage(p => Math.min(maxPage, p + 1))}
            />
          </Space>
        </div>
      )}
      {!compact && data.rows.length > 0 && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => {
              const csv = [
                colList.join(','),
                ...data.rows.map(row =>
                  colList.map(c => {
                    const v = row[c];
                    if (v === null || v === undefined) return '';
                    const s = String(v);
                    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
                  }).join(',')
                ),
              ].join('\n');
              const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `preview_${Date.now()}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载 CSV
          </Button>
        </div>
      )}
    </div>
  );
};
