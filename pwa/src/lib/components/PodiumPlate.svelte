<script lang="ts">
	import { base } from '$app/paths';
	import RankBadge from './RankBadge.svelte';
	import Avatar from './Avatar.svelte';
	import { rankOf, gamesOf, winrateOf, RK_PLATE } from '$lib/ranks';
	import { rankTitle } from '$lib/stores/rankinfo.svelte';
	import { statValue, MAST } from '$lib/boards';
	import Flag from '$lib/components/Flag.svelte';
	import CharSprite from './CharSprite.svelte';
	import ChallengeButton from './ChallengeButton.svelte';
	import { charTag } from '$lib/chars';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import type { Player, LeaderboardTab } from '$lib/types';

	let {
		player,
		place,
		tab,
		scoped = false,
		challenge = true
	}: { player: Player; place: 1 | 2 | 3; tab: LeaderboardTab; scoped?: boolean; challenge?: boolean } = $props();

	const r = $derived(rankOf(player.rating, gamesOf(player)));
	// Scoped podiums (Lobby/Tournament) carry no rating → no tier badge and a neutral plate accent.
	const acc = $derived(scoped ? RK_PLATE.civilian : (RK_PLATE[r.s] ?? RK_PLATE.civilian));
	const crown = $derived(place === 1);
	// the podium is the shop window: the top three stand WITH their most-played squads, worn skins on
	const team = $derived(Array.isArray(player.top_team) ? player.top_team.slice(0, 3) : []);
	const lo = $derived(team.length ? loadouts.peek(player.steamid) : null);
</script>

<div
	class="pod c{place}"
	class:crown
	style="--pa:{acc[0]}; --pb:{acc[1]}; --lb-acc:{MAST[tab][2]}"
>
	<span class="mark mono">{crown ? '👑' : '#' + place}</span>
	{#if player.steamid}
		<a class="av-link" href="{base}/u/{player.steamid}" aria-label={player.name || 'Player'}>
			<Avatar url={player.avatar} size={crown ? 58 : 46} alt={player.name} />
		</a>
		<a class="pnm plink" href="{base}/u/{player.steamid}">{#if player.cc}<Flag cc={player.cc} w={16} /> {/if}{player.name || 'Player'}</a>
	{:else}
		<Avatar url={player.avatar} size={crown ? 58 : 46} alt={player.name} />
		<b class="pnm">{#if player.cc}<Flag cc={player.cc} w={16} /> {/if}{player.name || 'Player'}</b>
	{/if}
	{#if player.registered}<span class="regmk" role="img" aria-label="Registered for this season" title="Registered">✓ Registered</span>{/if}
	{#if !scoped}
		<span class="ptier bd-tier">
			<RankBadge rating={player.rating} games={gamesOf(player)} size={crown ? 20 : 16} />
			<span class="rk-{r.s}" use:rankTitle={r.s}>{r.n}</span>
		</span>
	{/if}
	{#if team.length}
		<span class="squad" class:crown>
			{#each team as id, i (i)}<span class="sq" title={charTag(id)}><CharSprite {id} still palette={lo?.[id] ?? null} alt={charTag(id)} /></span>{/each}
		</span>
	{/if}
	<b class="prt">{statValue(player, tab)}</b>
	<span class="pwl">{player.wins ?? 0}W · {player.losses ?? 0}L · {winrateOf(player)}%</span>
	{#if player.steamid && challenge}
		<span class="chall"><ChallengeButton steamid={player.steamid} name={player.name || 'this player'} compact /></span>
	{/if}
</div>

<style>
	.pod {
		transform: skewX(-6deg);
		background:
			linear-gradient(120deg, color-mix(in srgb, var(--pa, var(--line)) 14%, transparent), transparent 70%),
			linear-gradient(180deg, var(--panel-2), var(--panel));
		border: 1px solid var(--line);
		border-left: 4px solid var(--pa, var(--line));
		border-radius: 13px;
		padding: 14px 12px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		cursor: default;
		min-width: 0;
		overflow: hidden;
	}
	.pwl,
	.regmk {
		font-size: 10px;
		font-weight: 700;
		color: var(--dim);
		border: 1px solid var(--faint);
		border-radius: 999px;
		padding: 0 7px;
	}
	.ptier {
		max-width: 100%;
	}
	.pod > :global(*) {
		transform: skewX(6deg);
	}
	.pod.crown {
		border-color: color-mix(in srgb, var(--gold) 55%, var(--line));
		border-left-color: var(--pa, var(--gold));
		box-shadow: 0 0 24px rgba(232, 185, 60, 0.08);
		padding-top: 18px;
	}
	.squad {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 4px;
		margin: 2px 0;
	}
	.squad .sq {
		display: block;
		width: 44px;
		height: 44px;
	}
	.squad.crown .sq {
		width: 56px;
		height: 56px;
	}
	/* If a portrait is missing, CharSprite shows a 3-letter code at 15px: scale it to the chip so codes never overlap. */
	.squad .sq :global(.abbr) {
		font-size: 11px;
		letter-spacing: 0;
	}
	.chall {
		margin-top: 4px;
	}
	.mark {
		font-weight: 800;
		font-size: 12px;
	}
	.crown .mark {
		font-size: 16px;
	}
	/* Real handles can be long ("twitch.tvducvader"): wrap to two lines so the part that identifies the player
	   is not the part that gets cut off. */
	.pnm {
		font-size: 14px;
		font-weight: 800;
		max-width: 100%;
		text-align: center;
		overflow: hidden;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.av-link {
		display: inline-flex;
		line-height: 0;
		text-decoration: none;
	}
	a.pnm {
		text-decoration: none;
		color: inherit;
	}
	a.pnm:hover {
		color: var(--gold);
	}
	.ptier {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 12.5px;
	}
	.prt {
		font-size: 22px;
		font-weight: 900;
		font-family: ui-monospace, Consolas, monospace;
		font-variant-numeric: tabular-nums;
	}
	.crown .prt {
		font-size: 27px;
		color: var(--gold);
	}
	.pwl {
		font-size: 11.5px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	/* On phones the skewX lean pushes the rightmost plate past the viewport (body is
	   overflow-x:hidden → it gets clipped). Straighten the plates and tighten padding so
	   all three fit exactly. */
	@media (max-width: 560px) {
		/* The squad is three portraits; at 44/56px they are wider than a phone-width plate and the side plates
		   clipped them. Size each chip from the plate's own width instead (inline-size container). */
		.pod {
			container-type: inline-size;
		}
		.squad {
			gap: 3px;
		}
		.squad .sq {
			width: min(44px, calc((100cqw - 6px) / 3));
			height: min(44px, calc((100cqw - 6px) / 3));
		}
		.squad.crown .sq {
			width: min(56px, calc((100cqw - 6px) / 3));
			height: min(56px, calc((100cqw - 6px) / 3));
		}
		.squad .sq :global(.abbr) {
			font-size: 9px;
		}
		.pod {
			transform: none;
			padding: 12px 8px 10px;
			gap: 4px;
		}
		.pod.crown {
			padding-top: 14px;
		}
		.pod > :global(*) {
			transform: none;
		}
		.pnm {
			font-size: 13px;
		}
		.prt {
			font-size: 20px;
		}
		.crown .prt {
			font-size: 24px;
		}
	}
</style>
