/**
 * 画布节点预览：列显示类型解析与单元格格式化（与 getDataTypeInfo 的 type 字符串一致）。
 */
import React from 'react';
import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import {
  PREVIEW_COLUMN_DISPLAY_AUTO,
  PREVIEW_COLUMN_DISPLAY_STRING,
  PREVIEW_COLUMN_DISPLAY_NUMBER,
  PREVIEW_COLUMN_DISPLAY_DATE,
  PREVIEW_COLUMN_DISPLAY_DATETIME,
  PREVIEW_COLUMN_DISPLAY_PERCENT,
} from '../constants/previewColumnDisplay';
import { isNil } from './isNil';

/** 从节点 config 读取 previewColumnFormats（仅对象形态时返回）。 */
export function getPreviewColumnFormatsFromConfig(cfg: unknown): Record<string, string> | undefined {
  if (Object.prototype.toString.call(cfg) !== '[object Object]') {
    return undefined;
  }
  const c = cfg as Record<string, unknown>;
  const p = c.previewColumnFormats;
  if (Object.prototype.toString.call(p) !== '[object Object]') {
    return undefined;
  }
  return p as Record<string, string>;
}

export function resolvePreviewColumnDisplayType(
  columnKey: string,
  columnIndex: number,
  columnTypes: string[] | undefined,
  overrides: Record<string, string> | undefined,
): string {
  let ov: string | undefined;
  if (overrides) {
    ov = overrides[columnKey];
  }
  if (ov && ov !== PREVIEW_COLUMN_DISPLAY_AUTO) {
    if (ov === PREVIEW_COLUMN_DISPLAY_STRING) {
      return 'string';
    }
    if (ov === PREVIEW_COLUMN_DISPLAY_NUMBER) {
      return 'decimal';
    }
    if (ov === PREVIEW_COLUMN_DISPLAY_PERCENT) {
      return 'percent';
    }
    if (ov === PREVIEW_COLUMN_DISPLAY_DATE) {
      return 'date';
    }
    if (ov === PREVIEW_COLUMN_DISPLAY_DATETIME) {
      return 'datetime';
    }
    return 'string';
  }
  let apiType: string | undefined;
  if (columnTypes && columnIndex >= 0 && columnIndex < columnTypes.length) {
    apiType = columnTypes[columnIndex];
  }
  if (apiType && apiType.length > 0) {
    return apiType;
  }
  return 'unknown';
}

export function formatPreviewCellValue(value: unknown, resolvedType: string): React.ReactNode {
  if (isNil(value)) {
    return <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>null</span>;
  }
  if (value === true || value === false) {
    const b = value;
    return (
      <Tag color={b ? 'green' : 'red'} style={{ fontSize: 11 }}>
        {b.toString()}
      </Tag>
    );
  }
  const t = resolvedType.toLowerCase();
  if (t === 'int' || t === 'bigint' || t === 'decimal' || t === 'float' || t === 'double') {
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) {
      return String(value);
    }
    return String(n);
  }
  if (t === 'percent') {
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) {
      return String(value);
    }
    // 将小数值转换为百分比显示，例如 0.123 -> 12.3%
    const percent = n * 100;
    return `${percent.toFixed(2)}%`;
  }
  if (t === 'date' || t === 'datetime' || t === 'timestamp') {
    const d = dayjs(String(value));
    if (!d.isValid()) {
      return String(value);
    }
    if (t === 'date') {
      return d.format('YYYY-MM-DD');
    }
    return d.format('YYYY-MM-DD HH:mm:ss');
  }
  const objTag = Object.prototype.toString.call(value);
  if (objTag === '[object Object]' || objTag === '[object Array]') {
    return (
      <Tooltip title={JSON.stringify(value)}>
        <code style={{ fontSize: 11 }}>{'{...}'}</code>
      </Tooltip>
    );
  }
  return String(value);
}
