<script lang="ts">
	import { REPOS, REPOS_LEAD } from '$lib/finale/repos';

	// "Check out the code": five public repos as plain cards. Links open in a new tab. A plain code-bracket icon from this
	// page's own set (not GitHub's logo); no counts or other live numbers.
</script>

<div class="code" id="code">
	<div class="shd"><h3 id="code-h" tabindex="-1">Check out the code</h3></div>
	<p class="ssub">{REPOS_LEAD}</p>
	<ul class="repos">
		{#each REPOS as r (r.url)}
			<li>
				<a class="repo" href={r.url} target="_blank" rel="noopener">
					<svg class="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M14 5l-4 14" /></svg>
					<span class="rt"><b>{r.name}</b><span>{r.line}</span></span>
				</a>
			</li>
		{/each}
	</ul>
</div>
