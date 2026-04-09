// Launch lanes concurrently for true parallel execution
// Stolen from Devin: multi-agent parallel instances

export async function launchLanesConcurrently(lanes: Lane[]) {
  const promises = lanes.map((lane) => processLane(lane));
  const results = await Promise.allSettled(promises);
  return results.map((result, i) => ({
    lane: lanes[i],
    status: result.status,
    value: result.status === "fulfilled" ? result.value : result.reason,
  }));
}

async function processLane(lane: Lane) {
  // Agent execution logic
  return lane.agent.run(lane.task);
}

interface Lane {
  agent: { run(task: unknown): Promise<unknown> | unknown };
  task: unknown;
}
