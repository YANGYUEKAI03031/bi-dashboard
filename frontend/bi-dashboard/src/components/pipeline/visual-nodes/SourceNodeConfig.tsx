/**
 * SourceNodeConfig - 在源节点内选择业务数据源 + 表（不再依赖管道表单顶栏）。
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Form, Select, Alert, Empty, Typography, Tag, Spin, Space, Divider, Button,
} from 'antd';
import { DatabaseOutlined, ReloadOutlined, TableOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { DataSourceService } from '../../../services/dataSourceService';

const { Text } = Typography;

interface DataSourceOption {
  id: string;
  name: string;
  type: string;
}

interface SourceNodeConfigProps {
  node: GraphNode;
  /** 兼容旧数据：节点未存数据源时使用管道级 ID */
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
  const form = Form.useFormInstance();
  const [allDataSources, setAllDataSources] = useState<DataSourceOption[]>([]);
  const [tables, setTables] = useState<{ name: string; columns?: Array<{ name: string; type: string }> }[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableColumns, setTableColumns] = useState<Array<{ name: string; type: string }>>([]);
  const [colsLoading, setColsLoading] = useState(false);

  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = pipelineNode.config || {};
  const selectedTable = config.tableName as string | undefined;

  /**
   * 与管道管理页一致：多数据源时首条视为系统默认库，管道选其余业务库；
   * 仅有一个数据源时仍应可选（否则 slice(1) 为空，下拉永远禁用）。
   */
  const businessDataSources = useMemo(() => {
    if (allDataSources.length === 0) return [];
    if (allDataSources.length === 1) return allDataSources;
    return allDataSources.slice(1);
  }, [allDataSources]);

  const configDsId = config.source_data_source_id as number | undefined;
  const effectiveDsId = configDsId ?? pipelineDataSourceId ?? undefined;

  useEffect(() => {
    let cancelled = false;
    DataSourceService.getDataSources()
      .then((list) => {
        if (!cancelled) setAllDataSources(list as DataSourceOption[]);
      })
      .catch(() => {
        if (!cancelled) setAllDataSources([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!effectiveDsId) {
      setTables([]);
      return;
    }
    let cancelled = false;
    setLoadingTables(true);
    DataSourceService.getTables(String(effectiveDsId))
      .then((list) => {
        if (!cancelled) setTables(list);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => { cancelled = true; };
  }, [effectiveDsId]);

  useEffect(() => {
    if (!effectiveDsId || !selectedTable) {
      setTableColumns([]);
      return;
    }
    let cancelled = false;
    setColsLoading(true);
    DataSourceService.getTableColumns(String(effectiveDsId), selectedTable)
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
  }, [effectiveDsId, selectedTable]);

  const handleDataSourceChange = (dsId: number | undefined) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const currentConfig = (pn.config as Record<string, unknown>) || {};
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...currentConfig,
          source_data_source_id: dsId,
          tableName: undefined,
          incrementalMode: false,
        },
        sql: '',
      },
    };
    setTableColumns([]);
    const pnAfter = node.data.pipelineNode as PipelineNode;
    form.setFieldsValue({ config: (pnAfter.config as Record<string, unknown>) || {} });
    onChange();
  };

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
    const pnAfter = node.data.pipelineNode as PipelineNode;
    form.setFieldsValue({ config: (pnAfter.config as Record<string, unknown>) || {} });
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
    const pnAfterInc = node.data.pipelineNode as PipelineNode;
    form.setFieldsValue({ config: (pnAfterInc.config as Record<string, unknown>) || {} });
    onChange();
  };

  const dsOptions = businessDataSources.map((ds) => ({
    label: `${ds.name} (${ds.type})`,
    value: parseInt(ds.id, 10),
  }));

  return (
    <div>
      <Form.Item
        label={
          <span>
            <DatabaseOutlined style={{ marginRight: 6 }} />
            数据源（业务库）
          </span>
        }
        required
        extra="将从此库选表生成查询。存在多个数据源时，首条一般为系统默认库，请选其余业务库；仅有一个数据源时可直接选用。"
      >
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={businessDataSources.length ? '请选择业务数据源' : '请先在数据源管理中新增业务库'}
          disabled={readOnly || !businessDataSources.length}
          notFoundContent={businessDataSources.length ? undefined : '暂无可用业务数据源'}
          value={effectiveDsId}
          onChange={(v) => handleDataSourceChange(v as number)}
          options={dsOptions}
        />
      </Form.Item>

      {!effectiveDsId && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无数据"
          style={{ margin: '12px 0' }}
        />
      )}

      {loadingTables && !!effectiveDsId && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin /> 加载表中…
        </div>
      )}
      {!loadingTables && !!effectiveDsId && (
        <>
          <Form.Item label="选择要导入的表" required>
            <Select
              showSearch
              optionFilterProp="label"
              value={selectedTable}
              onChange={handleTableChange}
              placeholder="搜索或选择数据库表…"
              disabled={readOnly}
              loading={loadingTables}
              suffixIcon={<TableOutlined />}
              options={tables.map((t) => ({ label: t.name, value: t.name }))}
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
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        if (effectiveDsId && selectedTable) {
                          setColsLoading(true);
                          DataSourceService.getTableColumns(String(effectiveDsId), selectedTable)
                            .then(setTableColumns)
                            .catch(() => setTableColumns([]))
                            .finally(() => setColsLoading(false));
                        }
                      }}
                    />
                  )}
                </Space>
              </div>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: '4px 8px',
                  background: '#fafafa',
                }}
              >
                {colsLoading && <Spin size="small" tip="加载字段…" />}
                {!colsLoading &&
                  tableColumns.map((col) => (
                    <div
                      key={col.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 0',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <Tag
                        style={{
                          background: '#EEF2FF',
                          color: '#6366F1',
                          border: 'none',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          minWidth: 50,
                        }}
                      >
                        {col.type.substring(0, 6)}
                      </Tag>
                      <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{col.name}</Text>
                    </div>
                  ))}
                {!colsLoading && tableColumns.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    无法加载字段信息
                  </Text>
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
