// A horizontal stacked allocation bar. Each segment is a fraction of the total,
// coloured by venue. Pure CSS, no chart dependency.
// No emojis, no em dashes (house style).
import { Box, Tooltip } from "@mantine/core";
import type { AllocSlice } from "./vault";
import { fmtDollars, fmtPercent } from "./vault";
import { usdFromWei } from "./vault";

export function StackedBar({
  slices,
  height = 16,
}: {
  slices: AllocSlice[];
  height?: number;
}) {
  const shown = slices.filter((s) => s.frac > 0);
  return (
    <Box
      style={{
        display: "flex",
        width: "100%",
        height,
        borderRadius: height / 2,
        overflow: "hidden",
        background: "rgba(255,255,255,0.06)",
      }}
    >
      {shown.map((s) => (
        <Tooltip
          key={s.key}
          label={`${s.label}: ${fmtDollars(usdFromWei(s.usd))} (${fmtPercent(s.frac)})`}
          withArrow
        >
          <Box
            style={{
              width: `${s.frac * 100}%`,
              height: "100%",
              background: s.color,
              transition: "width 400ms ease",
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
