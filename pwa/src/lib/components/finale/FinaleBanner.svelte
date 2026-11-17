<script lang="ts">
	import CountUp from './CountUp.svelte';

	// The hero: announcement + one-line totals (each sentence drops on its own) + the season picker. Choosing a
	// finished season goes to its page; choosing the current season goes to /ranks (the page tells which).
	let {
		label,
		date,
		bits,
		hasChampion,
		seasons,
		current,
		onpick,
		onjump
	}: {
		label: string;
		date: string;
		bits: { n: number; one: string; many: string; fmt?: (n: number) => string; tail?: { n: number; one: string; many: string } }[];
		hasChampion: boolean;
		seasons: { id: string; label: string; current: boolean }[];
		current: string;
		onpick: (id: string) => void;
		onjump: (id: string) => void;
	} = $props();
</script>

<section class="hero" id="top" aria-labelledby="top-h">
	<div class="ghost" aria-hidden="true">Final</div>
	<div class="over"><span class="rail">Season finale</span><span class="pill">Final</span></div>
	<h1 id="top-h" tabindex="-1">{label}</h1>
	<p class="tag">is in the books</p>
	<div class="seam" aria-hidden="true"></div>
	<div class="daterow">
		{#if date}<p class="date">{date}</p>{/if}
		{#if seasons.length > 1}
			<label class="pick"><span class="sr">Season</span>
				<select class="sel" value={current} onchange={(e) => onpick(e.currentTarget.value)}>
					{#each seasons as s (s.id)}<option value={s.id} selected={s.id === current}>{s.label}{s.current ? ' (current)' : ''}</option>{/each}
				</select></label>
		{/if}
	</div>
	{#if bits.length}
		<p class="lead">{#each bits as b (b.one)}<b><CountUp value={b.n} format={b.fmt} /></b> {b.n === 1 ? b.one : b.many}{#if b.tail}, against <b><CountUp value={b.tail.n} /></b> {b.tail.n === 1 ? b.tail.one : b.tail.many}{/if}.{' '}{/each}</p>
	{/if}
	<div class="cta">
		{#if hasChampion}<a class="btn pri" href="#podium" onclick={(e) => { e.preventDefault(); onjump('podium'); }}>See who won</a>{/if}
		<a class="btn" href="#explore" onclick={(e) => { e.preventDefault(); onjump('explore'); }}>Explore the season</a>
	</div>
</section>
