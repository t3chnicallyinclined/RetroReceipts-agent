<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';

	// ⚑ REPORT MODAL — the one report surface (profile + set receipts). Six standard reasons, no
	// catch-all "other" (free text rides the note, so every report stays classifiable). Server rules:
	// a recorded match reporter↔target within 24 HOURS (all reasons — reports are time-sensitive,
	// Tris 2026-08-26), 1 report per target per day. ≥3 distinct reporters in a rolling 30 days
	// raises the profile caution flag.
	let {
		target,
		name = 'this player',
		open = $bindable(false)
	}: { target: string; name?: string; open?: boolean } = $props();

	const REPORT_REASONS: { id: string; label: string; desc: string }[] = [
		{ id: 'rage_quit', label: 'Rage quit', desc: 'Left mid-game or dodged the rest of the set after losing' },
		{ id: 'no_show', label: 'No-show', desc: 'Accepted a challenge or wager, then never played' },
		{ id: 'lag_manipulation', label: 'Lag manipulation', desc: 'Suspicious lag spikes at key moments (lag switch / bad-faith VPN)' },
		{ id: 'rank_manipulation', label: 'Rank manipulation', desc: 'Win-trading, boosting, or smurf accounts farming rank' },
		{ id: 'toxic', label: 'Toxic behavior', desc: 'Harassment or abusive conduct' },
		{ id: 'impersonation', label: 'Impersonation', desc: "Copying another player's name or identity" }
	];
	let reason = $state('');
	let note = $state('');
	let busy = $state(false);
	let msg = $state<{ ok: boolean; text: string } | null>(null);

	async function submit(): Promise<void> {
		if (!reason || busy) return;
		busy = true;
		msg = null;
		const res = await auth.post('/rr/report', { target, reason, note: note.trim().slice(0, 280) });
		busy = false;
		if (res.ok) {
			msg = { ok: true, text: 'Report filed — thank you. Multiple independent reports raise a visible flag.' };
			reason = '';
			note = '';
			setTimeout(() => {
				open = false;
				msg = null;
			}, 2400);
		} else {
			msg = { ok: false, text: res.error ?? 'Could not file the report — try again shortly.' };
		}
	}
</script>

{#if open}
	<div class="rovl" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
		<div class="rdlg" role="dialog" aria-modal="true" aria-label="Report player">
			<button type="button" class="rx" onclick={() => (open = false)} aria-label="Close">✕</button>
			<h3 class="rhd">⚑ Report {name}</h3>
			<p class="rsub">Reports are reviewed and never public. <b>Reports are time-sensitive — you can only
				report a player within 24 hours of your match</b>, so file promptly. Multiple independent
				reports raise a visible caution flag.</p>
			<div class="rlist">
				{#each REPORT_REASONS as rr (rr.id)}
					<label class="ropt" class:sel={reason === rr.id}>
						<input type="radio" name="reason" value={rr.id} bind:group={reason} />
						<span class="rl">{rr.label}</span>
						<span class="rd">{rr.desc}</span>
					</label>
				{/each}
			</div>
			<textarea class="rnote" rows="2" maxlength="280" placeholder="Anything specific? (optional — session link, what happened)" bind:value={note}></textarea>
			{#if msg}<p class="rmsg" class:bad={!msg.ok}>{msg.text}</p>{/if}
			<div class="racts">
				<button type="button" class="rsend" disabled={!reason || busy} onclick={submit}>{busy ? 'Filing…' : 'File report'}</button>
				<button type="button" class="rcancel" onclick={() => (open = false)}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.rovl {
		position: fixed;
		inset: 0;
		z-index: 95;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		backdrop-filter: blur(3px);
	}
	.rdlg {
		position: relative;
		width: min(100%, 460px);
		max-height: 90vh;
		overflow-y: auto;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.rx {
		position: absolute;
		top: 10px;
		right: 10px;
		font: inherit;
		color: var(--faint);
		background: transparent;
		border: 0;
		cursor: pointer;
		font-size: 14px;
	}
	.rhd {
		margin: 0;
		font-size: 16px;
		font-weight: 800;
	}
	.rsub {
		margin: 0;
		font-size: 11.5px;
		color: var(--dim);
	}
	.rlist {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ropt {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 9px;
		align-items: center;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 9px;
		cursor: pointer;
	}
	.ropt.sel {
		border-color: color-mix(in srgb, var(--gold) 45%, var(--line));
		background: var(--gold-soft);
	}
	.ropt input {
		grid-row: 1 / span 2;
		accent-color: var(--gold);
	}
	.ropt .rl {
		font-size: 12.5px;
		font-weight: 800;
	}
	.ropt .rd {
		grid-column: 2;
		font-size: 10.5px;
		color: var(--dim);
	}
	.rnote {
		font: inherit;
		font-size: 12px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 8px 10px;
		resize: vertical;
	}
	.rmsg {
		margin: 0;
		font-size: 11.5px;
		color: var(--good);
	}
	.rmsg.bad {
		color: var(--dim);
	}
	.racts {
		display: flex;
		gap: 10px;
	}
	.rsend {
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 8px 18px;
		cursor: pointer;
	}
	.rsend:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.rcancel {
		font: inherit;
		font-size: 12px;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 8px 14px;
		cursor: pointer;
	}
</style>
