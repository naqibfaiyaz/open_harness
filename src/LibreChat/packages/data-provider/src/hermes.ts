/** Hermes is the owner of these resources; LibreChat's native agent loop is disabled in managed mode. */
export interface HermesStatus {
  enabled: boolean;
  managedOnly: boolean;
  canManage: boolean;
  workspacePath: string;
  scope: 'shared-trusted-workspace';
}
export interface HermesProfiles {
  profiles: { name: string; description?: string }[];
}
export interface HermesProgressSnapshot {
  id: string;
  active: boolean;
  tools: { id: string; tool: string; status: 'running' | 'completed' | 'interrupted' }[];
}
export interface HermesWorkspaceSession {
  workspacePath: string;
  renewAfterMs: number;
}
export interface HermesPublishResult {
  profile: string;
  ready: boolean;
}

export const hermesSections = [
  { path: '/profiles', key: 'com_hermes_agents' },
  { path: '/models', key: 'com_hermes_models' },
  { path: '/skills', key: 'com_hermes_skills' },
  { path: '/config', key: 'com_hermes_tools' },
  { path: '/mcp', key: 'com_hermes_mcp' },
  { path: '/plugins', key: 'com_hermes_plugins' },
  { path: '/cron', key: 'com_hermes_schedules' },
  { path: '/env', key: 'com_hermes_credentials' },
  { path: '/sessions', key: 'com_hermes_sessions' },
  { path: '/files', key: 'com_hermes_files' },
  { path: '/channels', key: 'com_hermes_channels' },
  { path: '/webhooks', key: 'com_hermes_webhooks' },
  { path: '/analytics', key: 'com_hermes_analytics' },
  { path: '/system', key: 'com_hermes_system' },
] as const;
