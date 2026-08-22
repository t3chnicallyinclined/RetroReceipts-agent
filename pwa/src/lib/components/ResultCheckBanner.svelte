<script lang="ts">
	// Result Check honest-beta banner — the ONE surface that legitimately uses amber (DESIGN-SYSTEM gold budget:
	// "Amber = the Result-Check banner only, app-wide"). A gold-tinted CAUTION wash, deliberately softer than
	// gold's "yours / primary action" use so it reads as a notice, not a prize. Dismissible; the choice persists.
	let dismissed = $state(true); // hidden until storage is read (no flash for a returning user)
	$effect(() => {
		try {
			dismissed = localStorage.getItem('rc_banner_seen') === '1';
		} catch {
			dismissed = false;
		}
	});
	function dismiss() {
		dismissed = true;
		try {
			localStorage.setItem('rc_banner_seen', '1');
		} catch {
			/* ignore */
		}
	}
</script>

{#if !dismissed}
	<aside class="rcb" role="note">
		<span class="ic" aria-hidden="true">⚠️</span>
		<p class="msg">
			<b>Ironing out win/loss bugs.</b> Some results land on the wrong player — it's a display glitch,
			<b>not lost data</b>. Every match is saved as a full replay, so records settle to the truth. See a
			wrong result? Open the <b>🔔 Result Check</b> bell up top. Stats are still being tuned — leaderboards
			may reset during beta.
		</p>
		<button class="got" onclick={dismiss}>Got it</button>
	</aside>
{/if}

<style>
	/* AMBER — reserved app-wide for Result Check only (DESIGN-SYSTEM "gold budget"). */
	.rcb {
		display: flex;
		align-items: center;
		gap: 11px;
		flex-wrap: wrap;
		margin: 0 0 12px;
		padding: 11px 15px;
		border: 1px solid color-mix(in srgb, var(--gold) 34%, var(--line));
		border-radius: 12px;
		background: color-mix(in srgb, var(--gold) 11%, var(--panel));
		color: var(--ink);
	}
	.ic {
		font-size: 17px;
		line-height: 1;
		flex: none;
	}
	.msg {
		flex: 1 1 320px;
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--ink);
	}
	.msg b {
		font-weight: 800;
	}
	.got {
		flex: none;
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 6px 14px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.got:hover {
		color: var(--ink);
		border-color: var(--faint);
	}
</style>
