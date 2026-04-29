<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  type Props = {
    size?: number;
    bg?: boolean;      // show the rounded-rect background
    class?: string;
  };
  let { size = 40, bg = true, class: cls = "" }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 140 140"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={cls}
  aria-hidden="true"
>
  {#if bg}
    <rect width="140" height="140" rx="28" fill="#0D0A07"/>
  {/if}
  <path
    d="M34 42 L70 100 L106 42"
    stroke="currentColor"
    stroke-width="10"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <circle cx="34"  cy="42"  r="7" fill="currentColor"/>
  <circle cx="106" cy="42"  r="7" fill="currentColor"/>
  <circle cx="70"  cy="100" r="7" fill="currentColor"/>
</svg>
