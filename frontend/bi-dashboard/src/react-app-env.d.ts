/// <reference types="react-scripts" />

// Legacy type aliases used in custom node components — the actual types come
// from @xyflow/react which re-exports them as `Node` and `Edge`.
import type { ReactNode, CSSProperties } from 'react';
import type { Position } from '@xyflow/react';

export type RFNode = {
  id: string;
  data: Record<string, unknown>;
  type?: string;
  position: Position;
  selected?: boolean;
  isConnectable?: boolean;
  [key: string]: unknown;
};

export type RFEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
  selected?: boolean;
  deletable?: boolean;
  draggable?: boolean;
  hidden?: boolean;
  label?: string | ReactNode;
  style?: CSSProperties;
  markerEnd?: string;
  markerStart?: string;
  [key: string]: unknown;
};
