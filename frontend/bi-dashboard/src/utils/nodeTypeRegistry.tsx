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
  AppstoreOutlined,
  ExportOutlined,
  HolderOutlined,
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
  transform: {
    type: 'transform',
    label: '数据转换',
    labelShort: '转换',
    color: '#52c41a',
    bgColor: '#F6FFED',
    borderColor: '#52c41a',
    tagBg: '#d9f7be',
    tagColor: '#52c41a',
    hasPreview: true,
    description: '对字段进行表达式转换',
    icon: <HolderOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select', 'transform'],
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
    description: '将多个上游节点合并',
    icon: <SwapOutlined />,
    allowedUpstreamTypes: ['source', 'filter', 'aggregate', 'join', 'column_select', 'transform', 'merge'],
  },
};

export const LEGACY_TYPE_MAP: Record<string, string> = {
  transform: 'filter',
  merge: 'join',
};

export function resolveNodeType(type: string): string {
  return LEGACY_TYPE_MAP[type] || type;
}

export function getNodeTypeDef(type: string): NodeTypeDefinition {
  return NODE_TYPE_REGISTRY[resolveNodeType(type)] || NODE_TYPE_REGISTRY.source;
}
