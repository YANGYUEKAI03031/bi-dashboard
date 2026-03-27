/**
 * SourceNodeConfig - Visual configuration for "Import Data" nodes.
 * Lets user pick a table from the business data source.
 */
import React, { useState, useEffect } from 'react';
import {
  Form, Select, Alert, Typography, Tag, Spin, Space, Divider, Button,
} from 'antd';
import { DatabaseOutlined, ReloadOutlined, TableOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { DataSourceService } from '../../../services/dataSourceService';

const { Text } = Typography;

interface SourceNodeConfigProps {
  node: GraphNode;
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

export const SourceNodeConfig: React.FC<SourceNodeConfigProps> = ({
  node,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const [tables, setTables] = useState<{ name: string; columns?: Array<{ name: string; type: string }> }[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableColumns, setTableColumns] = useState<Array<{ name: string; type: string }>>([]);
  const [colsLoading, setColsLoading] = useState(false);

  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = pipelineNode.config || {};
  const selectedTable = config.tableName;

  useEffect(() => {
    if (!pipelineDataSourceId) {
      setTables([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    DataSourceService.getTables(String(pipelineDataSourceId))
      .then((list) => {
        if (!cancelled) setTables(list);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [pipelineDataSourceId]);

  useEffect(() => {
    if (!pipelineDataSourceId || !selectedTable) {
      setTableColumns([]);
      return;
    }
    let cancelled = false;
    setColsLoading(true);
    DataSourceService.getTableColumns(String(pipelineDataSourceId), selectedTable)
      .then((cols) => {
        if (!cancelled) setTableColumns(cols);
      })
      .catch(() => {
        if (!cancelled) setTableColumns([]);
      })
      .finally(() => {
        if (!cancelled) setColsLoading(false);
      });
    return () => { cancelled = true; };
  }, [pipelineDataSourceId, selectedTable]);

  const handleTableChange = (tableName: string | undefined) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const currentConfig = (pn.config as Record<string, unknown>) || {};
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...currentConfig,
          tableName: tableName || undefined,
          incrementalMode: tableName ? (currentConfig.incrementalMode ?? false) : false,
        },
        sql: tableName ? `SELECT * FROM \`${tableName}\`` : '',
      },
    };
    setTableColumns([]);
    onChange();
  };

  const handleIncrementalToggle = (checked: boolean) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const currentConfig = (pn.config as Record<string, unknown>) || {};
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...currentConfig,
          incrementalMode: checked,
        },
      },
    };
    onChange();
  };

  if (!pipelineDataSourceId) {
    return (
      <Alert
        type="warning"
        showIcon
        message="请先在管道表单中选择业务数据源"
        description="在顶部表单选择数据源后，这里才能选择要导入的表。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  return (
    <div>
      {loading && <div style={{ textAlign: 'center', padding: 16 }}><Spin /> 加载表中…</div>}
      {!loading && (
        <>
          <Form.Item label="选择要导入的表" required>
            <Select
              showSearch
              optionFilterProp="label"
              value={selectedTable}
              onChange={handleTableChange}
              placeholder="搜索或选择数据库表…"
              disabled={readOnly}
              loading={loading}
              suffixIcon={<TableOutlined />}
              options={tables.map(t => ({ label: t.name, value: t.name }))}
            />
          </Form.Item>

          {selectedTable && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {tableColumns.length} 个字段
                </Text>
                <Space size={4} style={{ float: 'right' }}>
                  {colsLoading ? (
                    <Spin size="small" />
                  ) : (
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => {
                      if (pipelineDataSourceId && selectedTable) {
                        setColsLoading(true);
                        DataSourceService.getTableColumns(String(pipelineDataSourceId), selectedTable)
                          .then(setTableColumns)
                          .catch(() => setTableColumns([]))
                          .finally(() => setColsLoading(false));
                      }
                    }} />
                  )}
                </Space>
              </div>
              <div style={{
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '4px 8px',
                background: '#fafafa',
              }}>
                {colsLoading && <Spin size="small" tip="加载字段…" />}
                {!colsLoading && tableColumns.map(col => (
                  <div key={col.name} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}>
                    <Tag style={{
                      background: '#EEF2FF',
                      color: '#6366F1',
                      border: 'none',
                      fontSize: 10,
                      fontFamily: 'monospace',
                      minWidth: 50,
                    }}>
                      {col.type.substring(0, 6)}
                    </Tag>
                    <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{col.name}</Text>
                  </div>
                ))}
                {!colsLoading && tableColumns.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>无法加载字段信息</Text>
                )}
              </div>

              <Form.Item
                label={
                  <span>
                    <DatabaseOutlined style={{ marginRight: 4 }} />
                    导入模式
                  </span>
                }
                style={{ marginTop: 12, marginBottom: 0 }}
              >
                <Space>
                  <Select
                    value={config.incrementalMode ? 'incremental' : 'full'}
                    onChange={(v) => handleIncrementalToggle(v === 'incremental')}
                    size="small"
                    style={{ width: 140 }}
                    disabled={readOnly}
                    options={[
                      { label: '全量导入', value: 'full' },
                      { label: '增量导入', value: 'incremental' },
                    ]}
                  />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {config.incrementalMode
                      ? '只导入新增或变化的数据'
                      : '每次重新导入全部数据'}
                  </Text>
                </Space>
              </Form.Item>

              {config.incrementalMode && (
                <Alert
                  type="info"
                  showIcon
                  message="增量导入配置"
                  description="建议为源表配置「更新时间」字段（如 updated_at），管道将只导入该字段值大于上次执行时间的记录。"
                  style={{ marginTop: 8, fontSize: 11 }}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
