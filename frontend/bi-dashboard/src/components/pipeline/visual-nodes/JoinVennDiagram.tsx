/**
 * JoinVennDiagram — 左月牙 / 交集 / 右月牙 三区域独立点击切换点亮
 * 高亮描边按区域：交集为透镜形双边；仅月牙时为月牙轮廓，不画整圆。
 */
import React from 'react';
import { Typography } from 'antd';
import type { JoinVennRegions } from '../../../utils/pipelineJoinSql';

const { Text } = Typography;

export type JoinVennPart = 'left' | 'inner' | 'right';

interface JoinVennDiagramProps {
  regions: JoinVennRegions;
  onToggle: (part: JoinVennPart) => void;
  leftLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
}

const COLORS = {
  inner: '#6366F1',
  left: '#0EA5E9',
  right: '#22C55E',
  stroke: '#94a3b8',
};

const CX1 = 78;
const CX2 = 142;
const CY = 72;
const RAD = 50;

const dimOutline = { stroke: COLORS.stroke, strokeWidth: 1.5, fill: 'none' as const };

function ringStrong(color: string) {
  return {
    stroke: color,
    strokeWidth: 3,
    fill: 'none' as const,
    filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.45))',
  };
}

export const JoinVennDiagram: React.FC<JoinVennDiagramProps> = ({
  regions,
  onToggle,
  leftLabel = '左表',
  rightLabel = '右表',
  disabled = false,
}) => {
  const { left: L, inner: I, right: rightLit } = regions;

  const innerFill = I ? `${COLORS.inner}66` : `${COLORS.inner}28`;
  const leftFill = L ? `${COLORS.left}55` : `${COLORS.left}22`;
  const rightFill = rightLit ? `${COLORS.right}55` : `${COLORS.right}22`;

  const ptr = disabled ? 'default' : 'pointer';

  return (
    <div style={{ userSelect: 'none' }}>
      <svg
        viewBox="0 0 220 150"
        width="100%"
        style={{ maxWidth: 260, display: 'block', margin: '0 auto' }}
        role="img"
        aria-label="关联方式维恩图"
      >
        <defs>
          <mask id="join-venn-mask-left">
            <circle cx={CX1} cy={CY} r={RAD} fill="white" />
            <circle cx={CX2} cy={CY} r={RAD} fill="black" />
          </mask>
          <mask id="join-venn-mask-right">
            <circle cx={CX2} cy={CY} r={RAD} fill="white" />
            <circle cx={CX1} cy={CY} r={RAD} fill="black" />
          </mask>
          {/* 左圆 ∩ 右圆：用于裁出透镜的左弧（左圆在右圆内的部分） */}
          <clipPath id="join-venn-clip-inner">
            <circle cx={CX2} cy={CY} r={RAD} />
          </clipPath>
          {/* 右圆 ∩ 左圆：用于裁出透镜的右弧（右圆在左圆内的部分） */}
          <clipPath id="join-venn-clip-c1-full">
            <circle cx={CX1} cy={CY} r={RAD} />
          </clipPath>
        </defs>

        {/* 底图：两圆淡灰轮廓 */}
        <circle cx={CX1} cy={CY} r={RAD} {...dimOutline} pointerEvents="none" />
        <circle cx={CX2} cy={CY} r={RAD} {...dimOutline} pointerEvents="none" />

        {/* 仅 inner：透镜双边框（左弧 + 右弧） */}
        {I && !L && !rightLit && (
          <>
            <circle
              cx={CX1}
              cy={CY}
              r={RAD}
              clipPath="url(#join-venn-clip-inner)"
              pointerEvents="none"
              {...ringStrong(COLORS.inner)}
            />
            <circle
              cx={CX2}
              cy={CY}
              r={RAD}
              clipPath="url(#join-venn-clip-c1-full)"
              pointerEvents="none"
              {...ringStrong(COLORS.inner)}
            />
          </>
        )}

        {/* Left join：左整圆 + 透镜在右圆上的弧 */}
        {I && L && !rightLit && (
          <>
            <circle cx={CX1} cy={CY} r={RAD} pointerEvents="none" {...ringStrong(COLORS.left)} />
            <circle
              cx={CX2}
              cy={CY}
              r={RAD}
              clipPath="url(#join-venn-clip-c1-full)"
              pointerEvents="none"
              stroke={COLORS.left}
              strokeWidth={3}
              fill="none"
            />
          </>
        )}

        {/* Right join：右整圆 + 透镜在左圆上的弧 */}
        {I && !L && rightLit && (
          <>
            <circle cx={CX2} cy={CY} r={RAD} pointerEvents="none" {...ringStrong(COLORS.right)} />
            <circle
              cx={CX1}
              cy={CY}
              r={RAD}
              clipPath="url(#join-venn-clip-inner)"
              pointerEvents="none"
              stroke={COLORS.right}
              strokeWidth={3}
              fill="none"
            />
          </>
        )}

        {/* Full outer */}
        {I && L && rightLit && (
          <>
            <circle cx={CX1} cy={CY} r={RAD} pointerEvents="none" {...ringStrong(COLORS.left)} />
            <circle cx={CX2} cy={CY} r={RAD} pointerEvents="none" {...ringStrong(COLORS.right)} />
          </>
        )}

        {/* 仅左月牙（无交集）：不画整圆 */}
        {!I && L && (
          <circle
            cx={CX1}
            cy={CY}
            r={RAD}
            fill="none"
            mask="url(#join-venn-mask-left)"
            pointerEvents="none"
            {...ringStrong(COLORS.left)}
          />
        )}

        {/* 仅右月牙（无交集）：不画整圆 */}
        {!I && rightLit && (
          <circle
            cx={CX2}
            cy={CY}
            r={RAD}
            fill="none"
            mask="url(#join-venn-mask-right)"
            pointerEvents="none"
            {...ringStrong(COLORS.right)}
          />
        )}

        {/* 点击层（不变） */}
        <circle
          cx={CX1}
          cy={CY}
          r={RAD}
          fill={leftFill}
          mask="url(#join-venn-mask-left)"
          style={{ cursor: ptr }}
          onClick={() => !disabled && onToggle('left')}
        />
        <circle
          cx={CX2}
          cy={CY}
          r={RAD}
          fill={rightFill}
          mask="url(#join-venn-mask-right)"
          style={{ cursor: ptr }}
          onClick={() => !disabled && onToggle('right')}
        />
        <circle
          cx={CX1}
          cy={CY}
          r={RAD}
          fill={innerFill}
          clipPath="url(#join-venn-clip-inner)"
          style={{ cursor: ptr }}
          onClick={() => !disabled && onToggle('inner')}
        />

        <text x={CX1 - 18} y={CY - RAD - 8} fontSize={11} fill="#64748b">
          {leftLabel.length > 8 ? `${leftLabel.slice(0, 8)}…` : leftLabel}
        </text>
        <text x={CX2 - 18} y={CY - RAD - 8} fontSize={11} fill="#64748b">
          {rightLabel.length > 8 ? `${rightLabel.slice(0, 8)}…` : rightLabel}
        </text>
      </svg>

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 10, textAlign: 'center' }}>
        点击左月牙、重叠区、右月牙可分别开关；三处组合决定内连 / 左连 / 右连 / 全外 / 左反 / 右反 / 对称差
      </Text>
    </div>
  );
};
