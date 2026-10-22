<script lang="ts">
  interface Props {
    /** A translated message whose `{name}` placeholders stand for code. */
    text: string;
    /** The code shown in place of each placeholder. */
    codes: Record<string, string>;
  }

  let { text, codes }: Props = $props();
</script>

<!-- Code inside a sentence stays a placeholder in the message, so translations can move it: no {@html} needed. -->
{#each text.split(/\{(\w+)\}/) as part, n (n)}{#if n % 2}<code>{codes[part]}</code>{:else}{part}{/if}{/each}

<style>
  code {
    font-family: var(--mono);
    font-size: 12px;
  }
</style>
