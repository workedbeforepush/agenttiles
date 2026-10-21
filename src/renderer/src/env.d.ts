import type { CcdashApi } from '../../preload/api';

declare global {
  interface Window {
    ccdash: CcdashApi;
  }
}

export {};
