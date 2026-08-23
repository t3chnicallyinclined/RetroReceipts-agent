import { api } from '$lib/config';

// "Represent" location data + the real-cities typeahead. Mirrors the Tauri COUNTRIES / US_REGIONS lists
// (web/index.html) — keep in sync if either changes. The city lookup is an OPEN read (no auth), matching
// the server's /rr/cities handler (prefix match, ≥2 chars, pop-ordered).

export interface CityHit {
	name: string;
	region: string; // state / province (may be "")
	cc: string;
}

// [ISO2, display name]. Order = Tauri's (US first, then the FGC-relevant set). cc is the value sent to the server.
export const COUNTRIES: [string, string][] = [
	['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'], ['GB', 'United Kingdom'], ['FR', 'France'],
	['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'], ['PT', 'Portugal'], ['NL', 'Netherlands'],
	['BE', 'Belgium'], ['IE', 'Ireland'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'],
	['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['CZ', 'Czechia'],
	['SK', 'Slovakia'], ['HU', 'Hungary'], ['RO', 'Romania'], ['BG', 'Bulgaria'], ['GR', 'Greece'],
	['HR', 'Croatia'], ['RS', 'Serbia'], ['SI', 'Slovenia'], ['UA', 'Ukraine'], ['RU', 'Russia'],
	['TR', 'Turkey'], ['JP', 'Japan'], ['KR', 'South Korea'], ['CN', 'China'], ['TW', 'Taiwan'],
	['HK', 'Hong Kong'], ['SG', 'Singapore'], ['MY', 'Malaysia'], ['TH', 'Thailand'], ['VN', 'Vietnam'],
	['PH', 'Philippines'], ['ID', 'Indonesia'], ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'],
	['AU', 'Australia'], ['NZ', 'New Zealand'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['CL', 'Chile'],
	['CO', 'Colombia'], ['PE', 'Peru'], ['VE', 'Venezuela'], ['EC', 'Ecuador'], ['BO', 'Bolivia'],
	['PY', 'Paraguay'], ['UY', 'Uruguay'], ['CR', 'Costa Rica'], ['PA', 'Panama'], ['GT', 'Guatemala'],
	['HN', 'Honduras'], ['SV', 'El Salvador'], ['NI', 'Nicaragua'], ['DO', 'Dominican Republic'],
	['PR', 'Puerto Rico'], ['CU', 'Cuba'], ['JM', 'Jamaica'], ['TT', 'Trinidad & Tobago'], ['ZA', 'South Africa'],
	['NG', 'Nigeria'], ['EG', 'Egypt'], ['MA', 'Morocco'], ['DZ', 'Algeria'], ['TN', 'Tunisia'],
	['KE', 'Kenya'], ['GH', 'Ghana'], ['ET', 'Ethiopia'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'],
	['QA', 'Qatar'], ['KW', 'Kuwait'], ['IL', 'Israel'], ['JO', 'Jordan'], ['LB', 'Lebanon'],
	['IQ', 'Iraq'], ['IR', 'Iran'], ['IS', 'Iceland'], ['LU', 'Luxembourg'], ['EE', 'Estonia'],
	['LV', 'Latvia'], ['LT', 'Lithuania'], ['BY', 'Belarus'], ['MD', 'Moldova'], ['GE', 'Georgia'],
	['AM', 'Armenia'], ['AZ', 'Azerbaijan'], ['KZ', 'Kazakhstan'], ['UZ', 'Uzbekistan'], ['MN', 'Mongolia'],
	['NP', 'Nepal'], ['LK', 'Sri Lanka'], ['MM', 'Myanmar'], ['KH', 'Cambodia'], ['LA', 'Laos'],
	['MO', 'Macau'], ['FJ', 'Fiji'], ['CY', 'Cyprus'], ['MT', 'Malta'], ['AL', 'Albania'],
	['MK', 'North Macedonia'], ['BA', 'Bosnia & Herzegovina'], ['ME', 'Montenegro'], ['XK', 'Kosovo'],
	['AD', 'Andorra'], ['MC', 'Monaco'], ['LI', 'Liechtenstein'], ['SM', 'San Marino'], ['BZ', 'Belize'],
	['BS', 'Bahamas'], ['BB', 'Barbados'], ['GY', 'Guyana'], ['SR', 'Suriname'], ['AO', 'Angola'],
	['MZ', 'Mozambique'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['UG', 'Uganda'], ['TZ', 'Tanzania'],
	['CM', 'Cameroon'], ['CI', "Côte d'Ivoire"], ['SN', 'Senegal'], ['RW', 'Rwanda'], ['BW', 'Botswana'],
	['NA', 'Namibia'], ['LY', 'Libya'], ['SD', 'Sudan'], ['OM', 'Oman'], ['BH', 'Bahrain'],
	['YE', 'Yemen'], ['SY', 'Syria'], ['AF', 'Afghanistan'], ['BT', 'Bhutan'], ['MV', 'Maldives'],
	['BN', 'Brunei'], ['PG', 'Papua New Guinea'], ['NC', 'New Caledonia'], ['PF', 'French Polynesia'],
	['GU', 'Guam']
];

// US FGC / MvC2 "scenes" — repped instead of a plain state when country is USA. Keep in sync with Tauri.
export const US_REGIONS: string[] = [
	'SoCal', 'NorCal', 'Pacific Northwest', 'Southwest', 'Texas', 'Midwest', 'Great Lakes',
	'Southeast', 'Florida', 'Mid-Atlantic', 'Tri-State (NYC)', 'New England', 'Hawaii'
];

// ISO2 → display name, for resolving a country name from a picked city's cc.
export const CC_NAME: Record<string, string> = Object.fromEntries(COUNTRIES);

/**
 * Real-cities typeahead against GET /rr/cities (open read). Returns [] for <2 chars or any error —
 * the caller renders "no match". `country` (may be '') filters by cc server-side; prefix match, pop-ordered.
 */
export async function searchCities(country: string, q: string, limit = 8): Promise<CityHit[]> {
	const query = q.trim();
	if (query.length < 2) return [];
	const params = new URLSearchParams({ q: query, limit: String(limit) });
	if (country) params.set('country', country);
	try {
		const res = await fetch(api(`/rr/cities?${params.toString()}`), {
			headers: { accept: 'application/json' }
		});
		if (!res.ok) return [];
		const json = (await res.json()) as { ok?: boolean; cities?: CityHit[] };
		return json.cities ?? [];
	} catch {
		return [];
	}
}
