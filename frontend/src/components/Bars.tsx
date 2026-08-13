// Lightweight hand-rolled SVG / CSS bar visuals. No chart dependency added;
// these keep the "look at the graphs" surface cheap and theme-consistent.
// No emojis, no em dashes in this file (house style).
import { Box, Group, Text } from "@mantine/core";

export interface BarProps {
  // 0..1 fraction of the track to fill
  value: number;
  color?: string;
  height?: number;
  label?: string;
}

/** A single horizontal filled bar (fraction 0..1 of the track). */
export function Bar({ value, color = "#fe256d", height = 10 }: BarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <Box
      style={{
        width: "100%",
        height,
        borderRadius: height / 2,
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: height / 2,
          background: color,
          transition: "width 300ms ease",
        }}
      />
    </Box>
  );
}

/** A bar with a right-aligned numeric value beside it. */
export function LabeledBar({
  value,
  display,
  color,
  max = 1,
}: {
  value: number;
  display: string;
  color?: string;
  max?: number;
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Box style={{ flex: 1 }}>
        <Bar value={max > 0 ? value / max : 0} color={color} />
      </Box>
      <Text ff="monospace" size="xs" style={{ minWidth: 56, textAlign: "right" }}>
        {display}
      </Text>
    </Group>
  );
}

/**
 * A tiny sparkline-style column chart from a set of values, all scaled to the
 * max. Pure SVG. Used for the APY comparison across venues.
 */
export function MiniColumns({
  data,
  color = "#fe256d",
  width = 120,
  height = 34,
}: {
  data: { label: string; value: number }[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1e-9);
  const gap = 4;
  const colW = (width - gap * (data.length - 1)) / data.length;
  return (
    <svg width={width} height={height} role="img" aria-label="mini columns">
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 2);
        const x = i * (colW + gap);
        return (
          <rect
            key={d.label}
            x={x}
            y={height - h}
            width={colW}
            height={Math.max(h, 1)}
            rx={2}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
