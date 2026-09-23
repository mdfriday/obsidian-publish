/**
 * Publish-panel selection is independent of workspace focus.
 *
 * explicit — context menu, published target, command. Stays until the next explicit target.
 * follow — seeded from an empty panel, then tracks notes the user opens.
 * Panel controls (theme, demo, password) are not selection signals.
 */

export type SelectionOrigin = 'explicit' | 'follow';

export type FollowSignal =
	| { type: 'panel-focused'; hasTarget: boolean }
	| { type: 'active-file-changed'; hasTarget: boolean };

/** Whether a workspace signal may replace the current publish target. */
export function allowFollow(
	origin: SelectionOrigin | null,
	signal: FollowSignal,
): boolean {
	if (signal.type === 'panel-focused') {
		return origin == null && !signal.hasTarget;
	}
	if (signal.type === 'active-file-changed') {
		return origin !== 'explicit';
	}
	return false;
}
