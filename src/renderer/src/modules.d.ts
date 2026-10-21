// Ambient module declarations (this file must not contain imports or exports).
declare module '*.css';

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
