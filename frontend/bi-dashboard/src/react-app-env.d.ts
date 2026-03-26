/// <reference types="react-scripts" />

declare module '@xyflow/react' {
  import type { ReactNode, CSSProperties, Dispatch, SetStateAction } from 'react';

  export interface Position { x: number; y: number; }

  // Concrete base types — no generics
  export interface RFNode {
    id: string;
    data: Record<string, unknown>;
    type?: string;
    position: Position;
    selected?: boolean;
    isConnectable?: boolean;
    [key: string]: unknown;
  }

  export interface RFEdge {
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
  }

  export type Node = RFNode;
  export type Edge = RFEdge;

  export interface Connection {
    source: string | null;
    target: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    [key: string]: unknown;
  }

  export type NodeTypes = Record<string, unknown>;
  export type EdgeTypes = Record<string, unknown>;

  export interface Viewport { x: number; y: number; zoom: number; }

  export interface ReactFlowProps {
    nodes?: RFNode[];
    edges?: RFEdge[];
    onNodesChange?: (changes: Array<Record<string, unknown>>) => void;
    onEdgesChange?: (changes: Array<Record<string, unknown>>) => void;
    onConnect?: (connection: Connection) => void;
    onInit?: (instance: Record<string, unknown>) => void;
    onNodeDoubleClick?: (event: React.MouseEvent, node: RFNode) => void;
    onNodeClick?: (event: React.MouseEvent, node: RFNode) => void;
    onEdgeClick?: (event: React.MouseEvent, edge: RFEdge) => void;
    nodeTypes?: NodeTypes;
    edgeTypes?: EdgeTypes;
    defaultEdgeOptions?: RFEdge;
    defaultViewport?: Viewport;
    minZoom?: number;
    maxZoom?: number;
    defaultZoom?: number;
    snapToGrid?: boolean;
    snapGrid?: [number, number];
    nodesDraggable?: boolean;
    nodesConnectable?: boolean;
    elementsSelectable?: boolean;
    panOnScroll?: boolean;
    zoomOnScroll?: boolean;
    panOnDrag?: boolean | number[];
    fitView?: boolean;
    fitViewOptions?: { padding?: number };
    deleteKeyCode?: string | null;
    selectionMode?: number;
    onSelectionChange?: (params: { nodes: RFNode[]; edges: RFEdge[] }) => void;
    proOptions?: { hideAttribution?: boolean };
    disabled?: boolean;
    style?: CSSProperties;
    className?: string;
    children?: ReactNode;
  }

  export interface BackgroundProps {
    variant?: 'dots' | 'lines';
    gap?: number;
    size?: number;
    color?: string;
    style?: CSSProperties;
    className?: string;
  }

  export interface ControlsProps {
    showZoom?: boolean;
    showFitView?: boolean;
    showInteractive?: boolean;
    style?: CSSProperties;
    className?: string;
  }

  export interface MiniMapProps {
    nodeColor?: string | ((node: RFNode) => string);
    nodeStrokeWidth?: number;
    nodeBorderRadius?: number;
    nodePadding?: number;
    maskColor?: string;
    style?: CSSProperties;
    className?: string;
  }

  export interface PanelProps {
    position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    children?: ReactNode;
    style?: CSSProperties;
    className?: string;
  }

  export const ReactFlow: React.FC<ReactFlowProps>;
  export const Background: React.FC<BackgroundProps>;
  export const Controls: React.FC<ControlsProps>;
  export const MiniMap: React.FC<MiniMapProps>;
  export const Panel: React.FC<PanelProps>;

  export function useNodesState<T extends RFNode[]>(initialItems: T): [T, Dispatch<SetStateAction<T>>, (changes: Array<Record<string, unknown>>) => void];
  export function useEdgesState<T extends RFEdge[]>(initialItems: T): [T, Dispatch<SetStateAction<T>>, (changes: Array<Record<string, unknown>>) => void];
  export function useReactFlow(): {
    project: (position: { x: number; y: number }) => { x: number; y: number };
    fitView: (options?: { padding?: number; duration?: number }) => void;
    getViewport: () => Viewport;
    setViewport: (viewport: Viewport, options?: Record<string, unknown>) => void;
    getNodes: () => RFNode[];
    getEdges: () => RFEdge[];
    setNodes: Dispatch<SetStateAction<RFNode[]>>;
    setEdges: Dispatch<SetStateAction<RFEdge[]>>;
    addNodes: (nodes: RFNode | RFNode[]) => void;
    addEdges: (edges: RFEdge | RFEdge[]) => void;
    toObject: () => { nodes: RFNode[]; edges: RFEdge[]; viewport: Viewport };
  };

  export const ReactFlowProvider: React.FC<{ children: ReactNode }>;

  export type BackgroundVariant = 'dots' | 'lines';
}
