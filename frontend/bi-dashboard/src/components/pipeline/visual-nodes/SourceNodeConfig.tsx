/**
 * SourceNodeConfig - 在源节点内选择业务数据源 + 表（不再依赖管道表单顶栏）。
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Form, Select, Alert, Empty, Typography, Tag, Spin, Space, Divider, Button, InputNumber, Collapse,
} from 'antd';
import { DatabaseOutlined, ReloadOutlined, TableOutlined, SettingOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { DataSourceService } from '../../../services/dataSourceService';

const { Text } = Typography;
const { Panel } = Collapse;

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
        if (cancelled) return;
        setTableColumns(cols);
        if (!readOnly && cols.length > 0) {
          const names = cols.map((c) => c.name).filter(Boolean);
          const pn = node.data.pipelineNode as Record<string, unknown>;
          const cfg = { ...((pn.config as Record<string, unknown>) || {}) };
          const prev = cfg.sourceSchemaColumns as string[] | undefined;
          const same =
            Array.isArray(prev) &&
            prev.length === names.length &&
            prev.every((n, i) => n === names[i]);
          if (!same) {
            cfg.sourceSchemaColumns = names;
            node.data = {
              ...node.data,
              pipelineNode: { ...pn, config: cfg },
            };
            form.setFieldsValue({ config: cfg });
            onChange();
          }
        }
      })
      .catch(() => {
        if (!cancelled) setTableColumns([]);
      })
      .finally(() => {
        if (!cancelled) setColsLoading(false);
      });
    // 仅随库/表变化拉取结构；不把 node 放入依赖以免 onChange 触发的重渲染反复请求
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDsId, selectedTable, readOnly]);

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
          sourceSchemaColumns: undefined,
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
          sourceSchemaColumns: undefined,
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
                <>
                  <Form.Item
                    label="增量字段"
                    name={['config', 'incrementalField']}
                    extra="选择一个时间戳或自增 ID 字段作为增量标识"
                    style={{ marginBottom: 8 }}
                  >
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择增量字段..."
                      size="small"
                      disabled={readOnly}
                      value={config.incrementalField}
                      onChange={(v) => {
                        const pn = node.data.pipelineNode as Record<string, unknown>;
                        node.data = {
                          ...node.data,
                          pipelineNode: {
                            ...pn,
                            config: {
                              ...(pn.config as Record<string, unknown>) || {},
                              incrementalField: v,
                            },
                          },
                        };
                        onChange();
                      }}
                      options={tableColumns.map(col => ({
                          label: `${col.name} (${col.type})`,
                          value: col.name,
                        }))}
                    />
                  </Form.Item>

                  <Form.Item
                    label="条件类型"
                    style={{ marginBottom: 8 }}
                  >
                    <Select
                      size="small"
                      value={config.incrementalType || 'gt'}
                      onChange={(v) => {
                        const pn = node.data.pipelineNode as Record<string, unknown>;
                        node.data = {
                          ...node.data,
                          pipelineNode: {
                            ...pn,
                            config: {
                              ...(pn.config as Record<string, unknown>) || {},
                              incrementalType: v,
                            },
                          },
                        };
                        onChange();
                      }}
                      disabled={readOnly}
                      options={[
                        { label: '大于 (>)', value: 'gt' },
                        { label: '大于等于 (>=)', value: 'gte' },
                      ]}
                    />
                  </Form.Item>
                </>
              )}

              <Form.Item
                label="批量大小"
                name={['config', 'batchSize']}
                extra="每批处理的行数，太大可能导致内存问题"
                style={{ marginTop: 12, marginBottom: 0 }}
              >
                <InputNumber
                  min={100}
                  max={100000}
                  step={1000}
                  size="small"
                  style={{ width: 120 }}
                  value={config.batchSize || 5000}
                  onChange={(v) => {
                    const pn = node.data.pipelineNode as Record<string, unknown>;
                    node.data = {
                      ...node.data,
                      pipelineNode: {
                        ...pn,
                        config: {
                          ...(pn.config as Record<string, unknown>) || {},
                          batchSize: v || 5000,
                        },
                      },
                    };
                    onChange();
                  }}
                  disabled={readOnly}
                />
              </Form.Item>

              {config.incrementalMode && (
                <Alert
                  type="info"
                  showIcon
                  message="增量导入已启用"
                  description={
                    config.incrementalField
                      ? `每次执行只导入 ${config.incrementalField} ${config.incrementalType === 'gte' ? '>=' : '>'} 上次最大值的记录`
                      : '请选择增量字段以启用增量导入'
                  }
                  style={{ marginTop: 8, fontSize: 11 }}
                />
              )}

              {/* 数据变更自动触发配置 */}
              <Divider style={{ margin: '12px 0 8px' }} />
              <Form.Item
                label={
                  <Space>
                    <SettingOutlined />
                    <span>数据变更自动触发</span>
                  </Space>
                }
                style={{ marginBottom: 8 }}
              >
                <Space>
                  <Select
                    value={config.autoTriggerEnabled ? 'on' : 'off'}
                    onChange={(v) => {
                      const pn = node.data.pipelineNode as Record<string, unknown>;
                      node.data = {
                        ...node.data,
                        pipelineNode: {
                          ...pn,
                          config: {
                            ...(pn.config as Record<string, unknown>) || {},
                            autoTriggerEnabled: v === 'on',
                          },
                        },
                      };
                      onChange();
                    }}
                    size="small"
                    style={{ width: 120 }}
                    disabled={readOnly}
                    options={[
                      { label: '关闭', value: 'off' },
                      { label: '开启', value: 'on' },
                    ]}
                  />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {config.autoTriggerEnabled ? '当源表有新数据时自动触发执行' : '需要手动触发执行'}
                  </Text>
                </Space>
              </Form.Item>

              {config.autoTriggerEnabled && (
                <>
                  <Form.Item
                    label="轮询间隔"
                    style={{ marginBottom: 8 }}
                  >
                    <Select
                      size="small"
                      value={config.pollIntervalSeconds || 300}
                      onChange={(v) => {
                        const pn = node.data.pipelineNode as Record<string, unknown>;
                        node.data = {
                          ...node.data,
                          pipelineNode: {
                            ...pn,
                            config: {
                              ...(pn.config as Record<string, unknown>) || {},
                              pollIntervalSeconds: v,
                            },
                          },
                        };
                        onChange();
                      }}
                      disabled={readOnly}
                      options={[
                        { label: '每 1 分钟', value: 60 },
                        { label: '每 5 分钟', value: 300 },
                        { label: '每 15 分钟', value: 900 },
                        { label: '每 30 分钟', value: 1800 },
                        { label: '每 1 小时', value: 3600 },
                      ]}
                    />
                  </Form.Item>

                  <Form.Item
                    label="监控字段"
                    extra="用于检测数据变化的字段，推荐使用 id（主键自带索引）或 updated_at（需确保已建索引）"
                    style={{ marginBottom: 4 }}
                  >
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择监控字段..."
                      size="small"
                      disabled={readOnly}
                      value={config.triggerWatermarkField || config.incrementalField}
                      onChange={(v) => {
                        const pn = node.data.pipelineNode as Record<string, unknown>;
                        node.data = {
                          ...node.data,
                          pipelineNode: {
                            ...pn,
                            config: {
                              ...(pn.config as Record<string, unknown>) || {},
                              triggerWatermarkField: v,
                            },
                          },
                        };
                        onChange();
                      }}
                      options={tableColumns.map(col => ({
                        label: `${col.name} (${col.type})`,
                        value: col.name,
                      }))}
                    />
                  </Form.Item>

                  <Alert
                    type="warning"
                    showIcon
                    message="注意：源表监控字段需要有索引"
                    description="如果没有索引，轮询时会进行全表扫描。建议先在源表为监控字段建立索引：ALTER TABLE {table} ADD INDEX idx_{field} ({field});"
                    style={{ marginTop: 4, fontSize: 11 }}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
