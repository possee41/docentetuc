export function summarizeCpuProfile(profile) {
  if (!Array.isArray(profile?.nodes)) throw new Error("WORKERD_CPU_PROFILE_INCOMPLETE");
  const names = new Map(profile.nodes.map(node => [node.id, node.callFrame.functionName]));
  if (!Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas) ||
    profile.samples.length !== profile.timeDeltas.length || !profile.samples.length)
    throw new Error("WORKERD_CPU_PROFILE_INCOMPLETE");
  let activeUs = 0, idleUs = 0, activeSamples = 0;
  const sampledFrames = new Map();
  for (let index = 0; index < profile.samples.length; index++) {
    const name = names.get(profile.samples[index]);
    const delta = profile.timeDeltas[index];
    if (name === undefined || !Number.isFinite(delta) || delta < 0)
      throw new Error(`WORKERD_CPU_PROFILE_INVALID_SAMPLE ${JSON.stringify({ id: profile.samples[index], name, delta })}`);
    if (name === "(idle)") idleUs += delta;
    else {
      activeUs += delta;
      activeSamples++;
      sampledFrames.set(name, (sampledFrames.get(name) || 0) + delta);
    }
  }
  return { activeSampledMs: activeUs / 1000, idleSampledMs: idleUs / 1000,
    profileWindowMs: (profile.endTime - profile.startTime) / 1000, samples: profile.samples.length,
    activeSamples, lowResolution: activeSamples < 10,
    topSampledFrames: [...sampledFrames].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([functionName, microseconds]) => ({ functionName, sampledMs: microseconds / 1000 })) };
}

export async function connectWorkerdCpuProfiler(inspectorUrl) {
  const endpoint = new URL(inspectorUrl);
  if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1")
    throw new Error("WORKERD_INSPECTOR_NOT_LOCAL");
  endpoint.protocol = "http:";
  endpoint.pathname = "/json/list";
  const targets = await fetch(endpoint, { signal: AbortSignal.timeout(5000) }).then(response => response.json());
  const target = targets.find(item => item.id === "core:user:");
  if (!target?.webSocketDebuggerUrl) throw new Error("WORKERD_USER_TARGET_MISSING");
  if (new URL(target.webSocketDebuggerUrl).hostname !== "127.0.0.1")
    throw new Error("WORKERD_USER_TARGET_NOT_LOCAL");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    if (message.error) request.reject(new Error(`WORKERD_CDP_ERROR: ${message.error.message}`));
    else if (message.result || (message.method === request.method && request.method !== "Profiler.stop"))
      request.resolve(message.result || {});
    else return;
    clearTimeout(request.timer);
    pending.delete(message.id);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("WORKERD_CDP_CLOSED")); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WORKERD_CDP_CONNECT_TIMEOUT")), 5000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WORKERD_CDP_CONNECT_ERROR")); }, { once: true });
  });
  const send = method => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`WORKERD_CDP_TIMEOUT: ${method}`)); }, 10000);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ id, method }));
  });
  await send("Profiler.enable");
  return {
    async measure(operation) {
      await send("Profiler.start");
      let value;
      try { value = await operation(); }
      catch (error) { await send("Profiler.stop").catch(() => {}); throw error; }
      const result = await send("Profiler.stop");
      if (!result.profile) throw new Error("WORKERD_CPU_PROFILE_MISSING");
      return { value, cpu: summarizeCpuProfile(result.profile) };
    },
    close() { socket.close(); },
  };
}
