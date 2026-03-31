/**
 * JoinNodeConfig - 关联节点：维恩图选 JOIN 类型 + 从两路上游预览自动带出列名
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Select, Button, Divider, Tag, Typography,
  Alert, Card, Spin,
} from 'antd';
import { SwapOutlined, DeleteOutlined, WarningOutlined, PlusOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';
import {
  buildJoinPersistedSql,
  buildSymmetricUnionPlan,
  joinTypeToRegions,
  regionsToJoinType,
  type JoinVennRegions,
} from '../../../utils/pipelineJoinSql';
import { JoinVennDiagram, type JoinVennPart } from './JoinVennDiagram';

const { Text } = Typography;

interface JoinKey {
  id: string;
  leftCol: string;
  rightCol: string;
}

interface JoinNodeConfigProps {
  node: GraphNode;
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

export const JOIN_TYPES = [
  { value: 'inner', label: 'Inner Join', description: '只保留两边匹配的行', color: '#6366F1' },
  { value: 'left', label: 'Left Join', description: '保留左表全部，右表无匹配则填 NULL', color: '#0EA5E9' },
  { value: 'right', label: 'Right Join', description: '保留右表全部，左表无匹配则填 NULL', color: '#22C55E' },
  { value: 'full', label: 'Full Join', description: '保留两边全部行，无匹配则填 NULL', color: '#8B5CF6' },
  { value: 'left_anti', label: 'Left Anti', description: '仅保留左表中在右表无匹配键的行', color: '#F59E0B' },
  { value: 'right_anti', label: 'Right Anti', description: '仅保留右表中在左表无匹配键的行', color: '#EC4899' },
  { value: 'symmetric_diff', label: 'Symmetric diff', description: '仅左无匹配 ∪ 仅右无匹配（两侧列结构需一致才能 UNION）', color: '#64748B' },
];

function shortTableLabel(node: GraphNode): string {
  const pn = node.data.pipelineNode as PipelineNode;
  const cfg = (pn.config || {}) as Record<string, unknown>;
  const t = (cfg.tableName as string) || (cfg.table_name as string) || '';
  if (t) return t;
  const sql = typeof pn.sql === 'string' ? pn.sql : '';
  const m = sql.match(/FROM\s+[`"]?([a-zA-Z0-9_]+)[`"]?/i);
  return m ? m[1] : pn.name || '表';
}

export const JoinNodeConfig: React.FC<JoinNodeConfigProps> = ({
  node,
  allNodes,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedJoinType = (config.joinType as string) || 'inner';
  const savedJoinKeys = (config.joinKeys as JoinKey[]) || [];

  const [vennRegions, setVennRegions] = useState<JoinVennRegions>(() => joinTypeToRegions(savedJoinType));
  const [joinKeys, setJoinKeys] = useState<JoinKey[]>(
    savedJoinKeys.length > 0 ? savedJoinKeys : [{ id: `key_${Date.now()}`, leftCol: '', rightCol: '' }]
  );

  useEffect(() => {
    setVennRegions(joinTypeToRegions((config.joinType as string) || 'inner'));
  }, [config.joinType]);

  const joinType = regionsToJoinType(vennRegions);

  const leftPreview = useNodePreview();
  const rightPreview = useNodePreview();
  const autoFilledRef = useRef(false);
  const vennRegionsRef = useRef(vennRegions);
  const joinKeysRef = useRef(joinKeys);
  const leftColsRef = useRef<string[]>([]);
  const rightColsRef = useRef<string[]>([]);
  vennRegionsRef.current = vennRegions;
  joinKeysRef.current = joinKeys;
  leftColsRef.current = leftPreview.previewData?.columns ?? [];
  rightColsRef.current = rightPreview.previewData?.columns ?? [];

  const upstream = (pipelineNode.upstream as string[]) || [];
  const upstreamNodes = upstream.map(id => allNodes.find(n => n.id === id)).filter(Boolean) as GraphNode[];
  const leftNode = upstreamNodes[0];
  const rightNode = upstreamNodes[1];

  const leftDs = useMemo(
    () => resolvePreviewDataSourceId(leftNode?.data.pipelineNode as PipelineNode, pipelineDataSourceId ?? null),
    [leftNode, pipelineDataSourceId]
  );
  const rightDs = useMemo(
    () => resolvePreviewDataSourceId(rightNode?.data.pipelineNode as PipelineNode, pipelineDataSourceId ?? null),
    [rightNode, pipelineDataSourceId]
  );

  useEffect(() => {
    autoFilledRef.current = false;
  }, [leftNode?.id, rightNode?.id]);

  useEffect(() => {
    if (!leftNode || !leftDs) return;
    leftPreview.loadPreview(
      { node: leftNode, allNodes, pipelineDataSourceId: leftDs, limit: 80 },
      true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅上游或数据源变化时重拉
  }, [leftNode?.id, leftDs, allNodes]);

  useEffect(() => {
    if (!rightNode || !rightDs) return;
    rightPreview.loadPreview(
      { node: rightNode, allNodes, pipelineDataSourceId: rightDs, limit: 80 },
      true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightNode?.id, rightDs, allNodes]);

  const leftColumns = useMemo(
    () => (leftPreview.previewData?.columns || []).map(name => ({ name, type: 'string' })),
    [leftPreview.previewData?.columns]
  );
  const rightColumns = useMemo(
    () => (rightPreview.previewData?.columns || []).map(name => ({ name, type: 'string' })),
    [rightPreview.previewData?.columns]
  );

  const writeJoinState = useCallback(
    (nextRegions: JoinVennRegions, nextKeys: JoinKey[]) => {
      if (readOnly) return;
      const jt = regionsToJoinType(nextRegions);
      const symBuilt =
        jt === 'symmetric_diff'
          ? buildSymmetricUnionPlan(leftColsRef.current, rightColsRef.current)
          : [];
      const symPlan = jt === 'symmetric_diff' && symBuilt.length > 0 ? symBuilt : undefined;
      const sql = buildJoinPersistedSql(jt, nextKeys, symPlan);
      const pn = node.data.pipelineNode as Record<string, unknown>;
      const prevCfg = (pn.config || {}) as Record<string, unknown>;
      const nextCfg: Record<string, unknown> = {
        ...prevCfg,
        joinType: jt,
        joinKeys: nextKeys,
      };
      if (symPlan) {
        nextCfg.symmetricUnionPlan = symPlan;
      } else {
        delete nextCfg.symmetricUnionPlan;
      }
      node.data = {
        ...node.data,
        pipelineNode: {
          ...pn,
          sql,
          config: nextCfg,
        },
      };
      setVennRegions(nextRegions);
      setJoinKeys(nextKeys);
      onChange();
    },
    [readOnly, node, onChange]
  );

  /** 对称差：上游预览列加载后更新 symmetricUnionPlan / sql，避免 UNION 排序规则冲突 */
  useEffect(() => {
    if (readOnly) return;
    if (regionsToJoinType(vennRegions) !== 'symmetric_diff') return;
    const L = leftPreview.previewData?.columns ?? [];
    const R = rightPreview.previewData?.columns ?? [];
    if (!L.length && !R.length) return;
    const plan = buildSymmetricUnionPlan(L, R);
    const pn = node.data.pipelineNode as PipelineNode;
    const cfg = (pn.config || {}) as Record<string, unknown>;
    if (JSON.stringify(cfg.symmetricUnionPlan ?? null) === JSON.stringify(plan)) return;
    writeJoinState(vennRegionsRef.current, joinKeysRef.current);
  }, [
    readOnly,
    vennRegions.left,
    vennRegions.inner,
    vennRegions.right,
    leftPreview.previewData?.columns?.join('\0'),
    rightPreview.previewData?.columns?.join('\0'),
    writeJoinState,
    node.id,
  ]);

  /** 两表同名列，首次自动填一对匹配键 */
  useEffect(() => {
    if (autoFilledRef.current || readOnly) return;
    const L = leftPreview.previewData?.columns || [];
    const R = rightPreview.previewData?.columns || [];
    if (!L.length || !R.length) return;
    const pn = node.data.pipelineNode as PipelineNode;
    const jk = (pn.config?.joinKeys as JoinKey[] | undefined) || [];
    if (jk.some(k => k.leftCol && k.rightCol)) {
      autoFilledRef.current = true;
      return;
    }
    const same = L.filter(c => R.includes(c));
    if (same.length === 0) return;
    const pick = same[0];
    const newKeys = [{ id: joinKeysRef.current[0]?.id || `key_${Date.now()}`, leftCol: pick, rightCol: pick }];
    autoFilledRef.current = true;
    writeJoinState(vennRegionsRef.current, newKeys);
  }, [
    leftPreview.previewData?.columns?.join('\0'),
    rightPreview.previewData?.columns?.join('\0'),
    readOnly,
    writeJoinState,
  ]);

  const handleToggleVenn = (part: JoinVennPart) => {
    const next = { ...vennRegions, [part]: !vennRegions[part] };
    writeJoinState(next, joinKeys);
  };

  const addJoinKey = () => {
    const newKeys = [...joinKeys, { id: `key_${Date.now()}`, leftCol: '', rightCol: '' }];
    writeJoinState(vennRegions, newKeys);
  };

  const removeJoinKey = (id: string) => {
    const newKeys = joinKeys.filter(k => k.id !== id);
    if (newKeys.length === 0) {
      newKeys.push({ id: `key_${Date.now()}`, leftCol: '', rightCol: '' });
    }
    writeJoinState(vennRegions, newKeys);
  };

  const updateJoinKey = (id: string, field: 'leftCol' | 'rightCol', value: string) => {
    const newKeys = joinKeys.map(k => (k.id === id ? { ...k, [field]: value } : k));
    writeJoinState(vennRegions, newKeys);
  };

  /** 打开侧栏时若节点尚无 sql，按当前维恩图与匹配键写回（与导出时 graphUtils 补全一致） */
  useEffect(() => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as PipelineNode;
    if (String(pn.sql ?? '').trim()) return;
    writeJoinState(vennRegionsRef.current, joinKeysRef.current);
  }, [readOnly, node.id, writeJoinState]);

  if (upstreamNodes.length < 2) {
    return (
      <Alert
        type="info"
        showIcon
        message="需要两个上游节点"
        description={
          <div>
            关联节点需要至少两个上游数据源。
            当前已连接：{upstreamNodes.length} 个。
            请先添加更多节点并连接到本节点。
          </div>
        }
        style={{ marginBottom: 12 }}
      />
    );
  }

  const validKeys = joinKeys.filter(k => k.leftCol && k.rightCol);
  const loadingCols = leftPreview.previewLoading || rightPreview.previewLoading;
  const colError = leftPreview.previewError || rightPreview.previewError;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <SwapOutlined style={{ marginRight: 6 }} />
          关联方式
        </Text>
      </div>

      <JoinVennDiagram
        regions={vennRegions}
        onToggle={handleToggleVenn}
        leftLabel={shortTableLabel(leftNode)}
        rightLabel={shortTableLabel(rightNode)}
        disabled={readOnly}
      />

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>匹配键（ON 条件）</Text>
        {loadingCols && <Spin size="small" />}
        <Text type="secondary" style={{ fontSize: 11 }}>
          {validKeys.length} 个条件
        </Text>
      </div>

      {colError && (
        <Alert type="warning" showIcon message="列名加载失败" description={colError} style={{ marginBottom: 8, fontSize: 11 }} />
      )}

      {!loadingCols && !colError && leftColumns.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="未获取到左表列"
          description="请确认左上游节点已选表且数据源可用。"
          style={{ marginBottom: 8, fontSize: 11 }}
        />
      )}

      {joinKeys.map((key) => (
        <Card
          key={key.id}
          size="small"
          style={{ marginBottom: 8 }}
          bodyStyle={{ padding: '8px 10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag style={{ background: '#BAE6FD', color: '#0EA5E9', border: 'none', fontSize: 11 }}>
              左表
            </Tag>
            <Select
              size="small"
              placeholder={loadingCols ? '加载列…' : '左表字段'}
              value={key.leftCol || undefined}
              onChange={(val) => updateJoinKey(key.id, 'leftCol', val)}
              style={{ flex: 1 }}
              showSearch
              disabled={readOnly || loadingCols}
              options={leftColumns.map(c => ({ label: c.name, value: c.name }))}
              notFoundContent={loadingCols ? <Spin size="small" /> : '无列'}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Tag style={{ background: '#DDD6FE', color: '#8B5CF6', border: 'none', fontSize: 11 }}>
              右表
            </Tag>
            <Select
              size="small"
              placeholder={loadingCols ? '加载列…' : '右表字段'}
              value={key.rightCol || undefined}
              onChange={(val) => updateJoinKey(key.id, 'rightCol', val)}
              style={{ flex: 1 }}
              showSearch
              disabled={readOnly || loadingCols}
              options={rightColumns.map(c => ({ label: c.name, value: c.name }))}
              notFoundContent={loadingCols ? <Spin size="small" /> : '无列'}
            />
            {!readOnly && joinKeys.length > 1 && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeJoinKey(key.id)}
              />
            )}
          </div>
        </Card>
      ))}

      {!readOnly && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={addJoinKey}
          style={{ width: '100%', marginTop: 4 }}
        >
          添加匹配条件（多键关联）
        </Button>
      )}

      {joinType !== 'inner' && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="非内连时注意结果行数"
          description={
            joinType === 'left'
              ? 'Left Join 会保留左表所有行，右表无匹配时对应字段填充 NULL。'
              : joinType === 'right'
                ? 'Right Join 会保留右表所有行，左表无匹配时对应字段填充 NULL。'
                : joinType === 'full'
                  ? '全外连在 MySQL 中由「LEFT JOIN ∪ 右表独有行」UNION ALL 模拟，语义等价于 Full Outer。'
                  : joinType === 'left_anti'
                    ? 'Left Anti：只输出左表行，且这些行在 ON 条件下在右表没有匹配（右表列不出现在结果中）。'
                    : joinType === 'right_anti'
                      ? 'Right Anti：只输出右表行，且这些行在 ON 条件下在左表没有匹配（左表列不出现在结果中）。'
                      : '对称差：左无匹配行与右无匹配行 UNION；两侧输出列数与类型需一致，否则数据库会报错。'
          }
          style={{ marginTop: 12, fontSize: 11 }}
        />
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      <Text type="secondary" style={{ fontSize: 11 }}>生成的查询：</Text>
      <div
        style={{
          marginTop: 4,
          padding: '6px 10px',
          background: '#f5f7fa',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#595959',
          minHeight: 28,
        }}
      >
        {validKeys.length === 0 ? (
          <span style={{ color: '#bfbfbf' }}>（请添加匹配键）</span>
        ) : joinType === 'left_anti' ? (
          <span>
            SELECT a.* FROM left_table a<br />
            &nbsp;&nbsp;LEFT JOIN right_table b<br />
            &nbsp;&nbsp;ON {validKeys.map(k => `a.\`${k.leftCol}\` COLLATE utf8mb4_unicode_ci = b.\`${k.rightCol}\` COLLATE utf8mb4_unicode_ci`).join(' AND ')}
            <br />
            &nbsp;&nbsp;WHERE b.`{validKeys[0].rightCol}` IS NULL
          </span>
        ) : joinType === 'right_anti' ? (
          <span>
            SELECT b.* FROM left_table a<br />
            &nbsp;&nbsp;RIGHT JOIN right_table b<br />
            &nbsp;&nbsp;ON {validKeys.map(k => `a.\`${k.leftCol}\` COLLATE utf8mb4_unicode_ci = b.\`${k.rightCol}\` COLLATE utf8mb4_unicode_ci`).join(' AND ')}
            <br />
            &nbsp;&nbsp;WHERE a.`{validKeys[0].leftCol}` IS NULL
          </span>
        ) : joinType === 'full' ? (
          <span>
            SELECT * FROM left_table a LEFT JOIN right_table b ON …<br />
            &nbsp;&nbsp;UNION ALL<br />
            &nbsp;&nbsp;SELECT * FROM left_table a RIGHT JOIN right_table b ON …<br />
            &nbsp;&nbsp;WHERE a.`{validKeys[0].leftCol}` IS NULL
          </span>
        ) : joinType === 'symmetric_diff' ? (
          <span>
            SELECT a.* … WHERE b.`{validKeys[0].rightCol}` IS NULL<br />
            &nbsp;&nbsp;UNION ALL<br />
            &nbsp;&nbsp;SELECT b.* … WHERE a.`{validKeys[0].leftCol}` IS NULL
          </span>
        ) : (
          <span>
            SELECT * FROM left_table a<br />
            &nbsp;&nbsp;{JOIN_TYPES.find(j => j.value === joinType)?.label ?? joinType.toUpperCase()}{' '}
            JOIN right_table b<br />
            &nbsp;&nbsp;ON {validKeys.map(k => `a.\`${k.leftCol}\` COLLATE utf8mb4_unicode_ci = b.\`${k.rightCol}\` COLLATE utf8mb4_unicode_ci`).join(' AND ')}
          </span>
        )}
      </div>
    </div>
  );
};
