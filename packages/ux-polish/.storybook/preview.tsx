/**
 * Storybook preview configuration
 *
 * Global styles and parameters for all stories
 */

import type { Preview } from "@storybook/react";
import React from "react";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        {
          name: "dark",
          value: "#1e1e1e",
        },
        {
          name: "light",
          value: "#ffffff",
        },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          fontFamily: "monospace",
          fontSize: "14px",
          padding: "20px",
          minHeight: "400px",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
