<script lang="ts">
	// The phone dock: a fixed two-button bar above the app's TabBar, with its own backing so nothing readable shows
	// through behind the buttons. `--tabbar-h` (the real TabBar height) is set on the page root by the page.
	let { label, onmenu, onfeedback }: { label: string; onmenu: () => void; onfeedback: () => void } = $props();
</script>

<div class="dockbk" aria-hidden="true"></div>
<div class="dock">
	<button type="button" class="btn" aria-haspopup="dialog" aria-label="Sections menu, you are in {label}" onclick={onmenu}><span aria-hidden="true">☰</span><span>{label}</span></button>
	<a class="btn pri" href="#feedback" onclick={(e) => { e.preventDefault(); onfeedback(); }}><span>Have your say</span></a>
</div>
