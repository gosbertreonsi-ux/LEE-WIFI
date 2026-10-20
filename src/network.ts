// Network controller adapter (PRD section 9). THIS IS A MOCK: it logs but does NOT block or allow real traffic.
// Replace with a MikroTik / RADIUS / OpenWrt adapter after the Phase 0 router feasibility check.
export interface Controller {
  name: string;
  enforcing: boolean;
  authorize(s: { deviceId: string; expiresAt: Date }): Promise<void>;
  revoke(deviceId: string): Promise<void>;
}
export const network: Controller = {
  name: 'Mock controller',
  enforcing: false,
  async authorize(s) { console.log('[network] authorize', s.deviceId, 'until', s.expiresAt.toISOString()); },
  async revoke(deviceId) { console.log('[network] revoke', deviceId); },
};
