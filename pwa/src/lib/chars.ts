// MvC2 char-id → name map. Ported from web/skins/characters.json (the roster the live server keys
// match-report team arrays by: my_team/opp_team = numeric char_id triples). Embedded as a static
// module so the profile can render tiny team glyphs with no runtime fetch (matches the old app's
// `nameById`). Unknown ids fall back to `#id` — never blocks the row.

export const CHAR_NAME: Record<number, string> = {
	0: 'Ryu',
	1: 'Zangief',
	2: 'Guile',
	3: 'Morrigan',
	4: 'Anakaris',
	5: 'Strider',
	6: 'Cyclops',
	7: 'Wolverine',
	8: 'Psylocke',
	9: 'Iceman',
	10: 'Rogue',
	11: 'Captain America',
	12: 'Spider-Man',
	13: 'Hulk',
	14: 'Venom',
	15: 'Doctor Doom',
	16: 'Tron Bonne',
	17: 'Jill',
	18: 'Hayato',
	19: 'Ruby Heart',
	20: 'SonSon',
	21: 'Amingo',
	22: 'Marrow',
	23: 'Cable',
	27: 'Chun-Li',
	28: 'Mega Man',
	29: 'Roll',
	30: 'Akuma',
	31: 'BB Hood',
	32: 'Felicia',
	33: 'Charlie Nash',
	34: 'Sakura',
	35: 'Dan',
	36: 'Cammy',
	37: 'Dhalsim',
	38: 'M Bison',
	39: 'Ken',
	40: 'Gambit',
	41: 'Juggernaut',
	42: 'Storm',
	43: 'Sabretooth',
	44: 'Magneto',
	45: 'Shuma-Gorath',
	46: 'War Machine',
	47: 'Silver Samurai',
	48: 'Omega Red',
	49: 'Spiral',
	50: 'Colossus',
	51: 'Iron Man',
	52: 'Sentinel',
	53: 'Blackheart',
	54: 'Thanos',
	55: 'Jin',
	56: 'Captain Commando',
	57: 'Wolverine Bone Claw',
	58: 'Servbot'
};

/** Full character name for a char id (or `#id` when unknown). */
export function charName(id: number): string {
	return CHAR_NAME[id] ?? `#${id}`;
}

/** Compact 3-letter glyph for a char id (e.g. 44 → "MAG"), for dense team strips. */
export function charAbbr(id: number): string {
	const n = CHAR_NAME[id];
	if (!n) return `#${id}`;
	return n.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

/** A team array → "MAG / STO / SEN" (abbreviated). Empty/invalid → ''. */
export function teamAbbr(team: number[] | undefined | null): string {
	if (!Array.isArray(team) || !team.length) return '';
	return team.map(charAbbr).join(' / ');
}

/**
 * Exactly-4-character, collision-free, FGC-idiomatic tag for a char id — for dense monospace columns
 * (the set receipt's game rows), where the tags must line up and mean something at a glance.
 *
 * ⚠ Why a hand-authored table instead of `charName(id).slice(0, 4)`: that slice is genuinely broken on
 * this roster —
 *   • "Wolverine" and "Wolverine Bone Claw" both give WOLV, and "Captain America" / "Captain Commando"
 *     both give CAPT, so two different characters print identically;
 *   • "War Machine" gives "WAR " and "M Bison" gives "M BI" — an embedded/trailing space, which HTML
 *     collapses, so the column silently loses a character and the separators double up.
 * It also produces DOCT for a character every player on earth calls DOOM.
 *
 * Names shorter than 4 chars (RYU, ICE, DAN, KEN, JIN, PSY, BBH) are padded by LAYOUT — give the span a
 * `width: 4ch` — never by literal spaces, for the same HTML-collapsing reason.
 */
const CHAR_TAG: Record<number, string> = {
	0: 'RYU', 1: 'GIEF', 2: 'GUIL', 3: 'MORR', 4: 'ANAK', 5: 'STRD', 6: 'CYCL', 7: 'WOLV',
	8: 'PSYL', 9: 'ICEM', 10: 'ROGU', 11: 'CAPA', 12: 'SPDR', 13: 'HULK', 14: 'VENO', 15: 'DOOM',
	16: 'TRON', 17: 'JILL', 18: 'HAYA', 19: 'RUBY', 20: 'SONS', 21: 'AMIN', 22: 'MARR', 23: 'CABL',
	27: 'CHUN', 28: 'MEGA', 29: 'ROLL', 30: 'AKUM', 31: 'BBH',
	32: 'FELI', 33: 'CHAR', 34: 'SAKU', 35: 'DAN', 36: 'CAMM', 37: 'DHAL', 38: 'BISN', 39: 'KEN',
	40: 'GAMB', 41: 'JUGG', 42: 'STOR', 43: 'SABR', 44: 'MAGS', 45: 'SHUM', 46: 'WMCH', 47: 'SSAM',
	48: 'ORED', 49: 'SPIR', 50: 'COLO', 51: 'IRON', 52: 'SENT', 53: 'BHRT', 54: 'THAN', 55: 'JIN',
	56: 'CCOM', 57: 'BONE', 58: 'SRVB'
};

export function charTag(id: number): string {
	const t = CHAR_TAG[id];
	if (t) return t;
	// Unknown id: fall back to the name, stripped of anything that would break the column.
	const n = CHAR_NAME[id];
	return n ? n.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() : `#${id}`;
}
