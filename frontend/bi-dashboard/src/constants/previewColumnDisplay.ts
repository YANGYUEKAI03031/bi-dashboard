/** 画布底部节点预览：列显示格式（写入节点 config.previewColumnFormats） */

export const PREVIEW_COLUMN_DISPLAY_AUTO = 'auto';
export const PREVIEW_COLUMN_DISPLAY_STRING = 'string';
export const PREVIEW_COLUMN_DISPLAY_NUMBER = 'number';
export const PREVIEW_COLUMN_DISPLAY_DATE = 'date';
export const PREVIEW_COLUMN_DISPLAY_DATETIME = 'datetime';

export const PREVIEW_COLUMN_DISPLAY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: PREVIEW_COLUMN_DISPLAY_AUTO, label: '自动' },
  { value: PREVIEW_COLUMN_DISPLAY_STRING, label: '文本' },
  { value: PREVIEW_COLUMN_DISPLAY_NUMBER, label: '数字' },
  { value: PREVIEW_COLUMN_DISPLAY_DATE, label: '日期' },
  { value: PREVIEW_COLUMN_DISPLAY_DATETIME, label: '日期时间' },
];
