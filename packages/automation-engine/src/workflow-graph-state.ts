// ============================================================================
// @dantecode/automation-engine — Graph State Management
// Channel-based state with versioning and reducers
// ============================================================================

import {
  ChannelReducers,
  type StateChannel,
  type StateChannelConfig,
  type StateSchemaDefinition,
  type GraphState,
} from "./workflow-graph-types.js";

/**
 * Create a state channel from configuration.
 */
export function createChannel<T>(name: string, config: StateChannelConfig<T>): StateChannel<T> {
  return {
    name,
    value: config.default,
    version: 0,
    reducer: config.reducer,
    managed: config.managed,
  };
}

/**
 * Initialize graph state from schema definition.
 */
export function initializeGraphState<TState>(schema: StateSchemaDefinition<TState>): GraphState {
  const channels = new Map<string, StateChannel>();

  for (const [name, config] of Object.entries(schema)) {
    channels.set(name, createChannel(name, config as StateChannelConfig<unknown>));
  }

  return {
    channels,
    step: 0,
  };
}

/**
 * Update channel value with reducer logic.
 */
export function updateChannel<T>(channel: StateChannel<T>, newValue: T): void {
  if (channel.reducer && channel.value !== undefined) {
    channel.value = channel.reducer(channel.value, newValue);
  } else {
    channel.value = newValue;
  }
  channel.version++;
}

/**
 * Apply partial state updates to graph state.
 */
export function applyStateUpdates<TState>(graphState: GraphState, updates: Partial<TState>): void {
  for (const [key, value] of Object.entries(updates)) {
    const channel = graphState.channels.get(key);
    if (!channel) {
      throw new Error(`Channel '${key}' not found in state schema`);
    }
    updateChannel(channel, value);
  }
  graphState.step++;
}

/**
 * Get current state snapshot as typed object.
 */
export function getStateSnapshot<TState>(graphState: GraphState): TState {
  const snapshot: Record<string, unknown> = {};
  for (const [name, channel] of graphState.channels) {
    snapshot[name] = channel.value;
  }
  return snapshot as TState;
}

/**
 * Get channel value by name.
 */
export function getChannelValue<T>(graphState: GraphState, name: string): T | undefined {
  const channel = graphState.channels.get(name);
  return channel?.value as T | undefined;
}

/**
 * Clone graph state for checkpointing.
 */
export function cloneGraphState(graphState: GraphState): GraphState {
  const clonedChannels = new Map<string, StateChannel>();

  for (const [name, channel] of graphState.channels) {
    clonedChannels.set(name, {
      name: channel.name,
      value: structuredClone(channel.value),
      version: channel.version,
      reducer: channel.reducer,
      managed: channel.managed,
    });
  }

  return {
    channels: clonedChannels,
    step: graphState.step,
    checkpointId: graphState.checkpointId,
  };
}

/**
 * Serialize graph state to JSON.
 */
export function serializeGraphState(graphState: GraphState): string {
  const serializable = {
    step: graphState.step,
    checkpointId: graphState.checkpointId,
    channels: Array.from(graphState.channels.entries()).map(([name, channel]) => ({
      name,
      value: channel.value,
      version: channel.version,
      managed: channel.managed,
    })),
  };
  return JSON.stringify(serializable, null, 2);
}

/**
 * Deserialize graph state from JSON.
 */
export function deserializeGraphState<TState>(
  json: string,
  schema: StateSchemaDefinition<TState>,
): GraphState {
  const parsed = JSON.parse(json);
  const channels = new Map<string, StateChannel>();

  for (const channelData of parsed.channels) {
    const schemaConfig = schema[channelData.name as keyof TState] as StateChannelConfig<unknown>;
    if (!schemaConfig) {
      throw new Error(`Channel '${channelData.name}' not found in schema`);
    }

    channels.set(channelData.name, {
      name: channelData.name,
      value: channelData.value,
      version: channelData.version,
      reducer: schemaConfig.reducer,
      managed: channelData.managed,
    });
  }

  return {
    channels,
    step: parsed.step,
    checkpointId: parsed.checkpointId,
  };
}

/**
 * Validate state updates against schema.
 */
export function validateStateUpdates<TState>(
  updates: Partial<TState>,
  schema: StateSchemaDefinition<TState>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const key of Object.keys(updates)) {
    if (!(key in schema)) {
      errors.push(`Unknown channel '${key}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge multiple partial state updates.
 */
export function mergeStateUpdates<TState>(updates: Partial<TState>[]): Partial<TState> {
  const merged: Record<string, unknown> = {};

  for (const update of updates) {
    for (const [key, value] of Object.entries(update)) {
      merged[key] = value;
    }
  }

  return merged as Partial<TState>;
}

/**
 * Create a default state schema helper.
 */
export function defineStateSchema<TState>(
  schema: StateSchemaDefinition<TState>,
): StateSchemaDefinition<TState> {
  return schema;
}

/**
 * Export pre-configured reducers for convenience.
 */
export { ChannelReducers };
