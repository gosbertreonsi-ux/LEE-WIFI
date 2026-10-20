
export type ControllerMode = 'mock' | 'router';

export interface NetworkStatus {
  controller: string;
  mode: ControllerMode;
  enforcing: boolean;
  message: string;
}

export interface Controller {
  name: string;
  mode: ControllerMode;
  enforcing: boolean;

  status(): NetworkStatus;

  authorize(session: {
    deviceId: string;
    expiresAt: Date;
  }): Promise<void>;

  revoke(deviceId: string): Promise<void>;
}

// Safe local-development controller.
// It records intended actions but does NOT control real internet traffic.
export const network: Controller = {
  name: 'Mock controller',
  mode: 'mock',
  enforcing: false,

  status() {
    return {
      controller: this.name,
      mode: this.mode,
      enforcing: this.enforcing,
      message:
        'Development mode: session actions are logged only. ' +
        'Real network access is not enforced.',
    };
  },

  async authorize(session) {
    console.log(
      '[network] authorize',
      session.deviceId,
      'until',
      session.expiresAt.toISOString()
    );
  },

  async revoke(deviceId) {
    console.log('[network] revoke', deviceId);
  },
};
