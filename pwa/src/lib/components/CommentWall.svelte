<script lang="ts">
	import { comments, type CommentRow } from '$lib/stores/comments.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PlayerPlate from './PlayerPlate.svelte';
	import { timeAgo } from '$lib/format';

	// 💬 THE COMMENT WALL (LIVE-TAB-V2-SPEC §4) — the distinctive half of the beta: a comment can carry the
	// exact FRAME it is about, so "0:42" is a jump link rather than text someone typed.
	//
	// The copy's job is to make plain that a comment carries a name and a rank and lands on a real person's
	// record. The REFUSALS are never written here: the server owns every limit and answers in its own voice
	// (`easy — one comment every ten seconds`, and so on), so this prints `comments.error` verbatim. The one
	// client-side bound is `maxlength` on the textarea, which is an input affordance, not a second copy of the
	// rule — the server still validates length and answers `that is over 280 characters` if it is bypassed.

	let {
		matchKey,
		playable = false,
		getFrame = null,
		onSeek = null
	}: {
		matchKey: string;
		/** false = there is no timeline to point at (no tape, no WebGPU, phone `closed`) → the composer opens flat */
		playable?: boolean;
		/** read the playhead ON FOCUS — the anchor is the moment you were looking at when you started typing */
		getFrame?: (() => number) | null;
		/** jump the picture to a frame AND pause: the reader clicked to look at something */
		onSeek?: ((f: number) => void) | null;
	} = $props();

	const SORT_KEY = 'rr.wall.sort.v1';
	let sortByTime = $state(false);
	$effect(() => {
		try {
			sortByTime = localStorage.getItem(SORT_KEY) === 'time';
		} catch {
			/* no storage */
		}
	});
	function setSort(v: boolean) {
		sortByTime = v;
		try {
			localStorage.setItem(SORT_KEY, v ? 'time' : 'new');
		} catch {
			/* no storage */
		}
	}

	$effect(() => {
		void comments.open(matchKey);
	});

	const me = $derived(auth.steamid ?? '');
	const rows = $derived(comments.rows);
	/** on a fresh match recency IS the conversation; on an old one, timeline order reads better */
	const ordered = $derived.by(() => {
		if (!sortByTime) return rows;
		const anchored = rows.filter((r) => r.frame != null).sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
		const flat = rows.filter((r) => r.frame == null);
		return [...anchored, ...flat];
	});
	const firstFlatIdx = $derived(sortByTime ? ordered.findIndex((r) => r.frame == null) : -1);

	/** frames are 60/s of GAME time — the same mmss the player's own transport shows */
	function mmss(f: number): string {
		const s = Math.max(0, Math.round(f / 60));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	// ── the composer ────────────────────────────────────────────────────────────────────────────────────
	// Anchored is the DEFAULT and flat is the lesser case: the player already knows the exact frame, so the
	// anchor is exact rather than parsed out of text.
	let text = $state('');
	let anchored = $state(true);
	let anchorFrame = $state(0);
	let posting = $state(false);
	let focused = $state(false);
	const canAnchor = $derived(playable && anchored);

	function onFocus() {
		focused = true;
		if (playable && anchored) anchorFrame = getFrame?.() ?? 0; // take the moment you were looking at
	}

	async function submit() {
		const body = text.trim();
		if (!body || posting) return;
		posting = true;
		const r = await comments.post(body, canAnchor ? anchorFrame : null);
		posting = false;
		if (r.ok) {
			text = '';
			// posting PAUSES: you have said your piece about this moment and the conversation wants you now
			if (canAnchor && onSeek) onSeek(anchorFrame);
		}
	}

	function signIn() {
		auth.login(`/match?m=${encodeURIComponent(matchKey)}`);
	}

	// ── per-row actions ─────────────────────────────────────────────────────────────────────────────────
	let menuFor = $state('');
	let busy = $state('');
	const isAuthor = (c: CommentRow) => !!me && c.author === me;
	/** gold, because it is a VERIFIED FACT: this person fought in this match. The name itself stays --ink. */
	const foughtThis = (c: CommentRow) => comments.isParticipant(c.author);

	async function doHide(c: CommentRow) {
		if (!confirm('Hide this comment? It stays visible to whoever wrote it, and the count shows on your match.')) return;
		busy = c.id;
		await comments.hide(c.id, true);
		busy = '';
		menuFor = '';
	}
	async function doDelete(c: CommentRow) {
		if (!confirm('Delete your comment? There is no edit — delete and repost is the honest primitive on a public record.')) return;
		busy = c.id;
		await comments.del(c.id);
		busy = '';
		menuFor = '';
	}
	async function doReport(c: CommentRow) {
		if (!confirm('Report this comment? Three separate reports hide it while it is reviewed.')) return;
		busy = c.id;
		await comments.report(c.id, 'abuse');
		busy = '';
		menuFor = '';
	}
</script>

<section class="wall" data-test="comments" aria-label="Comments">
	<div class="whd">
		<h3>💬 Comments {#if comments.total}<span class="cnt">{comments.total}</span>{/if}</h3>
		{#if rows.length > 1}
			<div class="sort" role="group" aria-label="Comment order">
				<button type="button" class:on={!sortByTime} onclick={() => setSort(false)}>Newest</button>
				<button type="button" class:on={sortByTime} onclick={() => setSort(true)}>By time in match</button>
			</div>
		{/if}
	</div>

	<!-- the composer renders as a real input for EVERYONE; signing in happens in place, no modal -->
	<div class="composer" class:out={!auth.authed}>
		{#if auth.authed}
			{#if canAnchor}
				<div class="anchor">
					<span class="chip">@ {mmss(anchorFrame)}</span>
					<button type="button" class="drop" onclick={() => (anchored = false)} aria-label="Comment on the whole match instead">✕</button>
				</div>
			{:else if playable}
				<button type="button" class="reanchor" onclick={() => { anchored = true; anchorFrame = getFrame?.() ?? 0; }}>@ Mark this moment</button>
			{/if}
			<textarea
				bind:value={text}
				maxlength="280"
				rows="2"
				placeholder={canAnchor ? `Say something about ${mmss(anchorFrame)}…` : 'Say something about this match…'}
				onfocus={onFocus}
			></textarea>
			<div class="crow">
				<span class="posts">Posts as {auth.me?.name ?? 'you'}. This is on their record.</span>
				<span class="right">
					<span class="len" class:near={text.length > 250}>{text.length}/280</span>
					<button type="button" class="send" disabled={!text.trim() || posting} onclick={submit}>{posting ? '…' : 'Post'}</button>
				</span>
			</div>
		{:else}
			<p class="signline">Sign in with Steam to comment.</p>
			<button type="button" class="steam" onclick={signIn}>
				<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
					<circle cx="15" cy="9" r="2.4" fill="currentColor" />
					<path d="M6 15l4.5 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				</svg>
				<span>Sign in through Steam</span>
			</button>
		{/if}
		{#if comments.error}
			<!-- the SERVER's words, verbatim — never a local paraphrase of a rule it owns -->
			<p class="err" role="status">{comments.error}</p>
		{/if}
	</div>

	{#if comments.loading && !rows.length}
		<p class="note">Reading the wall…</p>
	{:else if !rows.length}
		<p class="note">
			{#if !playable}No tape for this one — comments here are about the match, not a moment.
			{:else if auth.authed}No one's said anything yet. Tap the tape at the moment you mean.
			{:else}No one's said anything yet.{/if}
		</p>
	{:else}
		<ul class="list">
			{#each ordered as c, i (c.id)}
				{#if sortByTime && i === firstFlatIdx && firstFlatIdx > 0}
					<li class="divider" aria-hidden="true">General</li>
				{/if}
				<li class="c" class:hidden={c.hidden}>
					<div class="chd">
						<PlayerPlate steamid={c.author} name={c.name} avatar={c.avatar} rating={c.rating} games={c.games} density="tag" />
						{#if foughtThis(c)}<span class="fought" title="Fought in this match">FOUGHT THIS</span>{/if}
						{#if c.frame != null}
							<button type="button" class="at" onclick={() => onSeek?.(c.frame ?? 0)} title="Jump to this moment and pause">@ {mmss(c.frame)}</button>
						{/if}
						<span class="when">{timeAgo(c.ts)}</span>
						<button type="button" class="more" aria-label="Comment actions" onclick={() => (menuFor = menuFor === c.id ? '' : c.id)}>⋯</button>
					</div>
					<!-- PLAIN TEXT ONLY: a URL renders as text and is never a link. Link rendering is the whole spam
					     economy, and on a platform with money matches a clickable link in a comment is a scam vector. -->
					<p class="body">{c.text}</p>
					{#if c.hidden}
						<p class="hid">
							{c.hidden_reason === 'reports'
								? 'Your comment was hidden after multiple reports.'
								: 'Hidden by the players — only you can see it.'}
						</p>
					{/if}
					{#if menuFor === c.id}
						<div class="menu">
							{#if isAuthor(c)}
								<button type="button" disabled={busy === c.id} onclick={() => doDelete(c)}>Delete</button>
							{/if}
							{#if comments.viewerIsParticipant && !c.hidden}
								<button type="button" disabled={busy === c.id} onclick={() => doHide(c)}>Hide</button>
							{/if}
							{#if auth.authed && !isAuthor(c)}
								<button type="button" disabled={busy === c.id} onclick={() => doReport(c)}>Report</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if comments.hiddenCount > 0}
		<!-- suppression that everyone can COUNT is self-limiting; suppression nobody can see is not -->
		<p class="foot">{comments.hiddenCount} comment{comments.hiddenCount === 1 ? '' : 's'} hidden by the players</p>
	{/if}
</section>

<style>
	.wall {
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		padding: 12px 14px;
	}
	.whd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}
	.whd h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink);
	}
	.cnt {
		color: var(--faint);
		font-weight: 700;
	}
	.sort {
		display: flex;
		gap: 4px;
	}
	.sort button {
		font: inherit;
		font-size: 10.5px;
		font-weight: 700;
		color: var(--faint);
		background: none;
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 3px 7px;
		cursor: pointer;
	}
	.sort button.on {
		color: var(--ink);
		border-color: var(--line);
		background: var(--panel-2);
	}
	.composer {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel-2);
		padding: 9px 10px;
		margin-bottom: 12px;
	}
	.anchor {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}
	.chip {
		font-size: 11px;
		font-weight: 700;
		color: var(--stream);
		border: 1px solid color-mix(in srgb, var(--stream) 45%, var(--line));
		border-radius: 6px;
		padding: 1px 7px;
	}
	.drop,
	.reanchor {
		font: inherit;
		font-size: 11px;
		color: var(--faint);
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0 2px;
	}
	.reanchor {
		margin-bottom: 6px;
		color: var(--stream);
		font-weight: 700;
	}
	.composer textarea {
		display: block;
		width: 100%;
		resize: vertical;
		font: inherit;
		font-size: 13px;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 7px 9px;
	}
	.crow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 7px;
	}
	.posts {
		font-size: 10.5px;
		color: var(--faint);
	}
	.right {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.len {
		font-size: 10.5px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.len.near {
		color: var(--gold);
	}
	.send {
		font: inherit;
		font-size: 12px;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 5px 14px;
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.signline {
		margin: 0 0 8px;
		font-size: 13px;
		color: var(--dim);
	}
	.steam {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		color: #dfe9f5;
		background: linear-gradient(180deg, #2a475e, #1b2838);
		border: 1px solid color-mix(in srgb, #66c0f4 35%, transparent);
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
	}
	.steam:hover {
		border-color: #66c0f4;
		color: #fff;
	}
	.err {
		margin: 8px 0 0;
		font-size: 12px;
		font-weight: 700;
		color: var(--live);
	}
	.note {
		margin: 14px 0;
		font-size: 12.5px;
		color: var(--dim);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.divider {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
		border-top: 1px dotted var(--line);
		padding-top: 8px;
	}
	.c.hidden {
		opacity: 0.6;
	}
	.chd {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-wrap: wrap;
	}
	.fought {
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.1em;
		color: var(--gold);
		border: 1px solid color-mix(in srgb, var(--gold) 45%, var(--line));
		border-radius: 5px;
		padding: 1px 5px;
	}
	.at {
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		color: var(--stream);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline dotted;
	}
	.when {
		font-size: 10.5px;
		color: var(--faint);
		margin-left: auto;
	}
	.more {
		font: inherit;
		font-size: 13px;
		line-height: 1;
		color: var(--faint);
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0 3px;
	}
	.body {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.hid {
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--gold);
	}
	.menu {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.menu button {
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 7px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.menu button:hover:not(:disabled) {
		color: var(--ink);
	}
	.foot {
		margin: 12px 0 0;
		font-size: 11px;
		color: var(--faint);
		border-top: 1px dotted var(--line);
		padding-top: 8px;
	}
</style>
