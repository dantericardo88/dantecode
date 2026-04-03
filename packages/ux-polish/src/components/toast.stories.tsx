/**
 * Toast component stories for Storybook
 *
 * Demonstrates CLI Toast notification system with different levels
 */

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ToastManager } from "./toast.js";
import AnsiToHtml from "ansi-to-html";

const convert = new AnsiToHtml({ fg: "#FFF", bg: "#1e1e1e" });

/**
 * React wrapper for Toast component
 * Captures ANSI output and renders as HTML
 */
function ToastWrapper({
  level,
  message,
  duration,
  showAction,
}: {
  level: "info" | "success" | "warning" | "error";
  message: string;
  duration?: number;
  showAction?: boolean;
}) {
  const [output, setOutput] = useState<string>("");

  useEffect(() => {
    // Mock stderr to capture output
    const originalWrite = process.stderr.write.bind(process.stderr);
    const mockWrite = ((chunk: string | Uint8Array) => {
      const str = typeof chunk === "string" ? chunk : chunk.toString();
      setOutput((prev) => prev + str);
      return true;
    }) as any;

    (process.stderr as any).write = mockWrite;

    const manager = new ToastManager();

    const options = {
      duration,
      ...(showAction
        ? {
            action: {
              label: "View Details",
              callback: () => {
                setOutput((prev) => prev + "\n[Action clicked]\n");
              },
            },
          }
        : {}),
    };

    manager[level](message, options);

    return () => {
      process.stderr.write = originalWrite;
      manager.clear();
    };
  }, [level, message, duration, showAction]);

  return (
    <pre
      style={{
        backgroundColor: "#1e1e1e",
        color: "#fff",
        padding: "20px",
        borderRadius: "4px",
        fontFamily: "monospace",
        fontSize: "14px",
        minHeight: "60px",
      }}
      dangerouslySetInnerHTML={{ __html: convert.toHtml(output) }}
    />
  );
}

const meta: Meta<typeof ToastWrapper> = {
  title: "CLI Components/Toast",
  component: ToastWrapper,
  tags: ["autodocs"],
  argTypes: {
    level: {
      control: "select",
      options: ["info", "success", "warning", "error"],
      description: "Toast level/severity",
    },
    message: {
      control: "text",
      description: "Notification message",
    },
    duration: {
      control: "number",
      description: "Auto-dismiss duration in ms (0 = persistent)",
    },
    showAction: {
      control: "boolean",
      description: "Show action button",
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToastWrapper>;

export const Info: Story = {
  args: {
    level: "info",
    message: "New version available",
    duration: 0,
  },
};

export const Success: Story = {
  args: {
    level: "success",
    message: "File saved successfully",
    duration: 0,
  },
};

export const Warning: Story = {
  args: {
    level: "warning",
    message: "Deprecated API usage detected",
    duration: 0,
  },
};

export const Error: Story = {
  args: {
    level: "error",
    message: "Failed to connect to database",
    duration: 0,
  },
};

export const WithAction: Story = {
  args: {
    level: "info",
    message: "Update available",
    duration: 0,
    showAction: true,
  },
};

export const Persistent: Story = {
  args: {
    level: "info",
    message: "This toast stays forever (duration: 0)",
    duration: 0,
  },
};

export const AutoDismiss: Story = {
  args: {
    level: "success",
    message: "This toast auto-dismisses after 3 seconds",
    duration: 3000,
  },
};
