import type { AgentTilesApi } from '../../preload/api';

declare global {
  interface Window {
    agenttiles: AgentTilesApi;
  }
}

export {};
