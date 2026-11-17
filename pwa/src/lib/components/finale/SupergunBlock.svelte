<script lang="ts">
	import { SUPERGUN_URL, SUPERGUN_DISCORD_URL } from '$lib/links';
	import { SUPERGUN_FEEDBACK } from '$lib/finale/repos';
	import { SUPERGUN_COMING, SUPERGUN_PITCH, SUPERGUN_POINTS, SUPERGUN_TODAY } from '$lib/finale/nextCopy';

	// SUPERGUN as a proper feature block: the pitch, four points, what works today and what is still coming, two
	// buttons, and (only once their copy exists) two small "also coming" cards. Static, fact-checked copy.
</script>

<div class="card sg">
	<span class="rail">Also in the works</span>
	<h3>SUPERGUN: where this goes next</h3>
	<p>{SUPERGUN_PITCH}</p>
	<dl class="pts">
		{#each SUPERGUN_POINTS as p (p.label)}<div><dt>{p.label}</dt><dd>{p.line}</dd></div>{/each}
	</dl>
	<div class="lists">
		<div class="lst"><span class="rail">Working today</span><ul>{#each SUPERGUN_TODAY as x (x)}<li>{x}</li>{/each}</ul></div>
		<div class="lst"><span class="rail">Still coming <span class="dimp">planned, no dates</span></span><ul>{#each SUPERGUN_COMING as x (x)}<li>{x}</li>{/each}</ul></div>
	</div>
	<div class="cta">
		<a class="btn pri" href={SUPERGUN_URL} rel="noopener">Get the SUPERGUN beta</a>
		<a class="btn" href={SUPERGUN_DISCORD_URL} rel="noopener">Join the SUPERGUN Discord</a>
	</div>
	<p class="sgfb">{SUPERGUN_FEEDBACK}</p>
</div>
