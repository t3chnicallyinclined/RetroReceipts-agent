// A comment's author plate. The server resolves the plate from the CURRENT season (comments carry no season of
// their own): after a season reset every author who has not yet played the new season is 1000 with 0 games. A
// rating-1000 "Civilian" badge would then be wrong for a veteran commenting on an old match, so the plate shows a
// rating and tier only for an author who has a real rank in the current season (5+ ranked games); otherwise just
// the name and avatar.
import { RANK_MIN_GAMES } from './ranks';

export function commentPlateRating(c: { rating: number; games: number }): number | null {
	return c.games >= RANK_MIN_GAMES ? c.rating : null;
}
