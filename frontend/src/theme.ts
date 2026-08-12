import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Flare-like accent (magenta/pink -> orange sits in the Flare palette).
const flare: MantineColorsTuple = [
  "#ffe9f3",
  "#ffd0e0",
  "#ff9fbf",
  "#ff6a9c",
  "#fe3f7e",
  "#fe256d",
  "#ff1364",
  "#e40053",
  "#cc0049",
  "#b3003e",
];

export const theme = createTheme({
  primaryColor: "flare",
  primaryShade: 6,
  colors: { flare },
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  defaultRadius: "md",
  headings: {
    fontWeight: "600",
  },
});
