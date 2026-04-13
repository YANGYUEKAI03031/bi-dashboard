/**
 * Pipeline node type registry
 * Defines visual properties and capabilities for each node type.
 * Used throughout the editor for rendering, icons, and configuration routing.
 */
import React from 'react';
import {
  DatabaseOutlined,
  FilterOutlined,
  BarChartOutlined,
  SwapOutlined,
  ColumnHeightOutlined,
  AppstoreOutlined,
  ExportOutlined,
  HolderOutlined,
  PieChartOutlined,
} from '@ant-design/icons';

/** Data type colors for column chips */
export const DATA_TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  string: { bg: '#EEF2FF', text: '#6366F1', label: 'Aa' },
  int: { bg: '#E0F2FE', text: '#0EA5E9', label: '#' },
  bigint: { bg: '#E0F2FE', text: '#0EA5E9', label: '#' },
  decimal: { bg: '#E0F2FE', text: '#0EA5E9', label: '.#' },
  float: { bg: '#E0F2FE', text: '#0EA5E9', label: '.#' },
  double: { bg: '#E0F2FE', text: '#0EA5E9', label: '.#' },
  date: { bg: '#FEF3C7', text: '#F59E0B', label: '~' },
  datetime: { bg: '#FEF3C7', text: '#F59E0B', label: '~' },
  timestamp: { bg: '#FEF3C7', text: '#F59E0B', label: '~' },
  bool: { bg: '#D1FAE5', text: '#10B981', label: 'T' },
  boolean: { bg: '#D1FAE5', text: '#10B981', label: 'T' },
  json: { bg: '#EDE9FE', text: '#8B5CF6', label: '{}' },
  array: { bg: '#FCE7F3', text: '#EC4899', label: '[]' },
  null: { bg: '#F3F4F6', text: '#6B7280', label: '?' },
  uuid: { bg: '#CCFBF1', text: '#14B8A6', label: '⇝' },
  unknown: { bg: '#F3F4F6', text: '#6B7280', label: '?' },
};

export function getDataTypeInfo(type: string): { bg: string; text: string; label: string } {
  const key = (type || 'unknown').toLowerCase()
    .replace(/varchar|text/, 'string')
    .replace(/int.*/, 'int')
    .replace(/double|float|decimal/, 'decimal');
  return DATA_TYPE_COLORS[key] || DATA_TYPE_COLORS.unknown;
}

export interface NodeTypeDefinition {
  type: string;
  label: string;
  labelShort: string;
  color: string;
  bgColor: string;
  borderColor: string;
  tagBg: string;
  tagColor: string;
  hasPreview: boolean;
  description: string;
  icon: React.ReactNode;
  allowedUpstreamTypes?: string[];
  /** 自定义 CSS 类名，用于特定节点类型的样式定制 */
  cssClass?: string;
}

/**
 * 新建/切换节点类型时下拉中的顺序（不含已下线的独立「过滤」类型；
 * 行筛选请用各节点预览面板的筛选，或「聚合」节点）。
 */
export const EDITOR_NODE_TYPE_ORDER: string[] = [
  'source',
  'aggregate',
  'join',
  'column_select',
  'transpose',
  'output',
  'chart',
  'merge',
];

/** 右侧配置「节点类型」下拉的选项；旧管道中的 filter 节点会额外带上 filter 一项 */
export function getEditorSelectableNodeTypeDefs(currentType?: string): NodeTypeDefinition[] {
  const ordered = EDITOR_NODE_TYPE_ORDER.map((k) => NODE_TYPE_REGISTRY[k]).filter(Boolean);
  if (currentType === 'filter') {
    return [NODE_TYPE_REGISTRY.filter, ...ordered];
  }
  return ordered;
}

export const NODE_TYPE_REGISTRY: Record<string, NodeTypeDefinition> = {
  source: {
    type: 'source',
    label: '数据源',
    labelShort: '源',
    color: '#6366F1',
    bgColor: '#EEF2FF',
    borderColor: '#6366F1',
    tagBg: '#E0E7FF',
    tagColor: '#6366F1',
    hasPreview: true,
    description: '从数据库表导入数据',
    icon: <DatabaseOutlined />,
    allowedUpstreamTypes: [],
  },
  /** 已下线：不再在编辑器中新建，仅兼容旧管道 */
  filter: {
    type: 'filter',
    label: '过滤',
    labelShort: '过滤',
    color: '#0EA5E9',
    bgColor: '#E0F2FE',
    borderColor: '#0EA5E9',
    tagBg: '#BAE6FD',
    tagColor: '#0EA5E9',
    hasPreview: true,
    description: '按条件筛选行',
    icon: <FilterOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
  aggregate: {
    type: 'aggregate',
    label: '聚合',
    labelShort: '聚合',
    color: '#22C55E',
    bgColor: '#F0FDF4',
    borderColor: '#22C55E',
    tagBg: '#BBF7D0',
    tagColor: '#22C55E',
    hasPreview: true,
    description: '按维度聚合计算（求和、计数、平均等）',
    icon: <BarChartOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
  join: {
    type: 'join',
    label: '关联',
    labelShort: '关联',
    color: '#8B5CF6',
    bgColor: '#EDE9FE',
    borderColor: '#8B5CF6',
    tagBg: '#DDD6FE',
    tagColor: '#8B5CF6',
    hasPreview: true,
    description: '将两个数据表按条件合并',
    icon: <SwapOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
  column_select: {
    type: 'column_select',
    label: '选择列',
    labelShort: '选列',
    color: '#F59E0B',
    bgColor: '#FEF3C7',
    borderColor: '#F59E0B',
    tagBg: '#FDE68A',
    tagColor: '#D97706',
    hasPreview: true,
    description: '选择需要的列并可重命名',
    icon: <AppstoreOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
  output: {
    type: 'output',
    label: '输出',
    labelShort: '输出',
    color: '#F97316',
    bgColor: '#FFF7ED',
    borderColor: '#F97316',
    tagBg: '#FED7AA',
    tagColor: '#EA580C',
    hasPreview: false,
    description: '将结果写入目标表',
    icon: <ExportOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
  merge: {
    type: 'merge',
    label: '合并节点',
    labelShort: '合并',
    color: '#fa8c16',
    bgColor: '#FFFAF0',
    borderColor: '#fa8c16',
    tagBg: '#FFE7BA',
    tagColor: '#FA541C',
    hasPreview: true,
    description: '纵向拼接多路数据（UNION / UNION ALL），按列位置对齐',
    icon: <ColumnHeightOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select', 'merge'],
    cssClass: 'merge',
  },
  chart: {
    type: 'chart',
    label: '数据可视化',
    labelShort: '图表',
    color: '#722ed1',
    bgColor: '#f9f0ff',
    borderColor: '#d3adf7',
    tagBg: '#722ed1',
    tagColor: '#fff',
    hasPreview: true,
    description: '将上游数据可视化展示为图表',
    icon: <PieChartOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select', 'merge'],
  },
  transpose: {
    type: 'transpose',
    label: '转置',
    labelShort: '转置',
    color: '#13c2c2',
    bgColor: '#e6fffb',
    borderColor: '#13c2c2',
    tagBg: '#87e8de',
    tagColor: '#08979c',
    hasPreview: true,
    description: '将纵向数据转为横向报表（类似 Excel 数据透视表）',
    icon: <SwapOutlined style={{ transform: 'rotate(90deg)' }} />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select'],
  },
};

/** 仅用于展示/兼容：后端预览 SQL 仍会把 transform 规范为 filter 逻辑（勿把 merge 映射到 join，否则 UI 会错用关联样式） */
export const LEGACY_TYPE_MAP: Record<string, string> = {};

export function resolveNodeType(type: string): string {
  return LEGACY_TYPE_MAP[type] || type;
}

export function getNodeTypeDef(type: string): NodeTypeDefinition {
  return NODE_TYPE_REGISTRY[resolveNodeType(type)] || NODE_TYPE_REGISTRY.source;
}
