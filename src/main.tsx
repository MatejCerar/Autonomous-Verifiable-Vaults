// Make BigInt JSON-serializable so any JSON.stringify of a value holding a
// BigInt (in our code, a dependency, React dev tooling, or a wallet extension)
// returns the numeric string instead of throwing "BigInt value can't be
// serialized in JSON", which would otherwise crash a render mid-update.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return (this as unknown as bigint).toString();
};

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { App } from "@/App";
import { theme } from "@/theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
);
