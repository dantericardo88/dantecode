/**
 * Spinner component stories for Storybook
 *
 * Demonstrates CLI Spinner component with different states and options
 */

import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Spinner, SPINNERS } from "./spinner.js";
import AnsiToHtml from "ansi-to-html";

const convert = new AnsiToHtml({ fg: "#FFF", bg: "#1e1e1e" });

/**
 * React wrapper for Spinner component
 * Captures ANSI output and renders as HTML
 */
function SpinnerWrapper({
  text,
  spinnerName = "dots",
  color = "cyan",
  action,
}: {
  text: string;
  spinnerName?: keyof typeof SPINNERS;
  color?: "cyan" | "yellow" | "green" | "red";
  action?: "succeed" | "fail" | "warn" | "info" | "none";
}) {
  const [output, setOutput] = useState<string>("");
  const spinnerRef = useRef<Spinner | null>(null);

  useEffect(() => {
    // Mock stream to capture output
    const mockStream = {
      write: (chunk: string) => {
        setOutput((prev) => prev + chunk);
      },
      isTTY: true,
    } as any;

    const spinner = new Spinner({
      text,
      spinner: spinnerName,
      color,
      stream: mockStream,
    });

    spinnerRef.current = spinner;
    spinner.start();

    // Simulate action after 2 seconds
    const timer = setTimeout(() => {
      if (action === "succeed") {
        spinner.succeed("Done!");
      } else if (action === "fail") {
        spinner.fail("Failed!");
      } else if (action === "warn") {
        spinner.warn("Warning!");
      } else if (action === "info") {
        spinner.info("Info");
      } else {
        spinner.stop();
      }
    }, 2000);

    return () => {
      clearTimeout(timer);
      spinner.stop();
    };
  }, [text, spinnerName, color, action]);

  return (
    <pre
      style={{
        backgroundColor: "#1e1e1e",
        color: "#fff",
        padding: "20px",
        borderRadius: "4px",
        fontFamily: "monospace",
        fontSize: "14px",
        minHeight: "100px",
      }}
      dangerouslySetInnerHTML={{ __html: convert.toHtml(output) }}
    />
  );
}

const meta: Meta<typeof SpinnerWrapper> = {
  title: "CLI Components/Spinner",
  component: SpinnerWrapper,
  tags: ["autodocs"],
  argTypes: {
    text: {
      control: "text",
      description: "Loading message to display",
    },
    spinnerName: {
      control: "select",
      options: Object.keys(SPINNERS),
      description: "Spinner animation style",
    },
    color: {
      control: "select",
      options: ["cyan", "yellow", "green", "red"],
      description: "Spinner color",
    },
    action: {
      control: "select",
      options: ["succeed", "fail", "warn", "info", "none"],
      description: "Final action to perform",
    },
  },
};

export default meta;
type Story = StoryObj<typeof SpinnerWrapper>;

export const Default: Story = {
  args: {
    text: "Loading...",
    spinnerName: "dots",
    color: "cyan",
    action: "none",
  },
};

export const Success: Story = {
  args: {
    text: "Building project...",
    spinnerName: "dots",
    color: "green",
    action: "succeed",
  },
};

export const Error: Story = {
  args: {
    text: "Running tests...",
    spinnerName: "dots",
    color: "red",
    action: "fail",
  },
};

export const Warning: Story = {
  args: {
    text: "Checking dependencies...",
    spinnerName: "dots",
    color: "yellow",
    action: "warn",
  },
};

export const LineSpinner: Story = {
  args: {
    text: "Fetching data...",
    spinnerName: "line",
    color: "cyan",
    action: "succeed",
  },
};

export const ArrowSpinner: Story = {
  args: {
    text: "Processing...",
    spinnerName: "arrow",
    color: "green",
    action: "succeed",
  },
};

export const CircleSpinner: Story = {
  args: {
    text: "Initializing...",
    spinnerName: "circle",
    color: "cyan",
    action: "succeed",
  },
};
