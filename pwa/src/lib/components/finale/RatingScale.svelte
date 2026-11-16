<script lang="ts">
	// Upset: a rating scale with a filled gold mark (the winner) and a hollow mark (the opponent), the span between
	// them and both ratings labelled. The opponent is a rating only, never a name.
	let { winner, opponent }: { winner: number; opponent: number } = $props();
	const lo = $derived(Math.floor((Math.min(winner, opponent) - 60) / 50) * 50);
	const hi = $derived(Math.ceil((Math.max(winner, opponent) + 60) / 50) * 50);
	const x = (v: number) => (100 * (v - lo)) / (hi - lo);
</script>

<div role="img" aria-label="Winner rated {winner}, opponent rated {opponent}">
	<div class="scale">
		<i class="span" style="left:{x(Math.min(winner, opponent))}%;width:{Math.abs(x(opponent) - x(winner))}%"></i>
		<i class="dot" style="left:{x(opponent)}%"></i>
		<i class="dot win" style="left:{x(winner)}%"></i>
	</div>
	<div class="scalex" aria-hidden="true">
		<span style="left:{x(winner)}%"><b>{winner}</b>winner</span>
		<span style="left:{x(opponent)}%"><b>{opponent}</b>opponent</span>
	</div>
</div>
