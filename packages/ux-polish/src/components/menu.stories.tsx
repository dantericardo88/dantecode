/**
 * Menu component stories for Storybook
 *
 * Demonstrates CLI Menu component with different modes and options
 */

import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { MenuItem } from "./menu.js";

/**
 * React wrapper for Menu component
 * Renders static menu visualization (interactive version requires TTY)
 */
function MenuWrapper({
  title,
  items,
  multi,
  selectedIndex = 0,
}: {
  title: string;
  items: MenuItem<string>[];
  multi?: boolean;
  selectedIndex?: number;
}) {
  const [selected] = useState<number>(selectedIndex);

  const renderItem = (item: MenuItem<string>, index: number) => {
    const isSelected = index === selected;
    const cursor = isSelected ? "❯" : " ";
    const checkbox = multi ? (isSelected ? "◉" : "◯") : "";
    const color = isSelected ? "#50fa7b" : item.disabled ? "#6272a4" : "#f8f8f2";
    const checkboxColor = multi ? "#bd93f9" : "";

    return (
      <div key={index} style={{ fontFamily: "monospace", color }}>
        <span style={{ color: isSelected ? "#50fa7b" : "#6272a4" }}>{cursor}</span>{" "}
        {checkbox && <span style={{ color: checkboxColor }}>{checkbox} </span>}
        {item.label}
        {item.description && isSelected && (
          <div style={{ paddingLeft: "24px", color: "#6272a4", fontSize: "0.9em" }}>
            {item.description}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        backgroundColor: "#1e1e1e",
        color: "#f8f8f2",
        padding: "20px",
        borderRadius: "4px",
        fontFamily: "monospace",
        fontSize: "14px",
      }}
    >
      <div style={{ color: "#8be9fd", marginBottom: "16px" }}>{title}</div>
      {items.map((item, i) => renderItem(item, i))}
      <div style={{ color: "#6272a4", marginTop: "16px", fontSize: "0.9em" }}>
        ↑↓: Navigate | Enter: Select | Esc: Cancel
        {multi && " | Space: Toggle"}
      </div>
    </div>
  );
}

const meta: Meta<typeof MenuWrapper> = {
  title: "CLI Components/Menu",
  component: MenuWrapper,
  tags: ["autodocs"],
  argTypes: {
    title: {
      control: "text",
      description: "Menu title",
    },
    multi: {
      control: "boolean",
      description: "Enable multi-select mode",
    },
    selectedIndex: {
      control: "number",
      description: "Currently selected index",
    },
  },
};

export default meta;
type Story = StoryObj<typeof MenuWrapper>;

export const SingleSelect: Story = {
  args: {
    title: "Select a file",
    multi: false,
    selectedIndex: 0,
    items: [
      { label: "index.ts", value: "index.ts" },
      { label: "config.ts", value: "config.ts" },
      { label: "utils.ts", value: "utils.ts" },
    ],
  },
};

export const MultiSelect: Story = {
  args: {
    title: "Select files to include",
    multi: true,
    selectedIndex: 0,
    items: [
      { label: "src/index.ts", value: "src/index.ts" },
      { label: "src/config.ts", value: "src/config.ts" },
      { label: "src/utils.ts", value: "src/utils.ts" },
      { label: "tests/index.test.ts", value: "tests/index.test.ts" },
    ],
  },
};

export const WithDescriptions: Story = {
  args: {
    title: "Choose an action",
    multi: false,
    selectedIndex: 0,
    items: [
      {
        label: "Build",
        value: "build",
        description: "Compile TypeScript to JavaScript",
      },
      {
        label: "Test",
        value: "test",
        description: "Run all unit tests with Vitest",
      },
      {
        label: "Deploy",
        value: "deploy",
        description: "Deploy to production environment",
      },
    ],
  },
};

export const WithDisabledItems: Story = {
  args: {
    title: "Select deployment target",
    multi: false,
    selectedIndex: 0,
    items: [
      { label: "Development", value: "dev" },
      { label: "Staging", value: "staging" },
      {
        label: "Production",
        value: "prod",
        disabled: true,
        description: "Insufficient permissions",
      },
    ],
  },
};

export const LongList: Story = {
  args: {
    title: "Select a package",
    multi: false,
    selectedIndex: 2,
    items: [
      { label: "@dantecode/core", value: "core" },
      { label: "@dantecode/cli", value: "cli" },
      { label: "@dantecode/config-types", value: "config-types" },
      { label: "@dantecode/git-engine", value: "git-engine" },
      { label: "@dantecode/memory-engine", value: "memory-engine" },
      { label: "@dantecode/ux-polish", value: "ux-polish" },
      { label: "@dantecode/vscode", value: "vscode" },
      { label: "@dantecode/web-extractor", value: "web-extractor" },
    ],
  },
};

export const FilteredResults: Story = {
  args: {
    title: "Search: test",
    multi: false,
    selectedIndex: 0,
    items: [
      { label: "test.ts", value: "test.ts" },
      { label: "test-utils.ts", value: "test-utils.ts" },
      { label: "integration.test.ts", value: "integration.test.ts" },
    ],
  },
};
