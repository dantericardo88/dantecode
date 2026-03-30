/**
 * Storybook configuration for ux-polish components
 *
 * Renders CLI components (Spinner, Toast, Menu) as React wrappers
 * with ANSI-to-HTML conversion for visual documentation.
 */

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal: async (config) => {
    // Ensure TypeScript resolves correctly
    return config;
  },
};

export default config;
