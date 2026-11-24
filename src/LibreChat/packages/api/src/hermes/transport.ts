interface TransportConfig {
  config?: { hermes?: { enabled?: boolean; managedOnly?: boolean; endpointName?: string } };
}
interface TransportParams {
  agent: object;
  endpointOption?: { endpoint?: string | null };
  runtime?: { appConfig?: TransportConfig } | null;
  req?: { config?: TransportConfig } | null;
}

export class HermesExecutionRequiredError extends Error {
  readonly code = 'HERMES_EXECUTION_REQUIRED';
  constructor() {
    super(
      'Managed mode requires the Hermes chat transport. Configure agents and tools in Hermes workspace.',
    );
    this.name = 'HermesExecutionRequiredError';
  }
}

/** LibreChat's unified chat transport uses AgentClient even for custom endpoints.
 * Disable its local skill, memory and execution layer before any resource priming.
 * Hermes profiles remain the sole owner of these capabilities.
 */
export function hermesTransportParams<T extends TransportParams>(params: T): T {
  const appConfig = params.runtime?.appConfig ?? params.req?.config;
  const config = appConfig?.config?.hermes;
  if (!config?.enabled || !config.managedOnly) return params;
  // Also covers API/background ingress that does not pass through the interactive chat router.
  if (params.endpointOption?.endpoint !== config.endpointName)
    throw new HermesExecutionRequiredError();
  return {
    ...params,
    agent: {
      ...params.agent,
      tools: [],
      tool_options: {},
      tool_resources: {},
      agent_ids: [],
      edges: [],
      subagents: undefined,
    },
    accessibleSkillIds: [],
    manualSkills: [],
    skillAuthoringAvailable: false,
    memoryAvailable: false,
    codeEnvAvailable: false,
    fileSearchAvailable: false,
  } as T;
}
