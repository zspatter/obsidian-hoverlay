/**
 * Dismissal policy: which events close the popover in which states. Pure
 * decision logic so the full state x event matrix can be swept in tests;
 * PopoverManager reads DOM state, builds a DismissalState and applies the
 * verdict. Transient interaction guards (mid-drag, mid-resize) stay in the
 * manager: closing during pointer capture would break the gesture, so they
 * suppress everything regardless of policy.
 */

export type StickyMode = "hover" | "sticky";

export type DismissalEvent =
	/** hover wind-down: the pointer left the link/popover or wandered off links */
	| "pointer-leave"
	/** mousedown outside the popover */
	| "outside-click"
	/** wheel outside the popover (the note under it would scroll to stale context) */
	| "outside-wheel"
	/** a required trigger modifier was released (close-on-release setting) */
	| "modifier-release"
	/** Escape, pressed in the host or forwarded from the guest page */
	| "escape"
	/** the header X button */
	| "close-button";

export interface DismissalState {
	mode: StickyMode;
	/** per-popover pin: survive everything except explicit closes */
	pinned: boolean;
	maximized: boolean;
	/** the guest page holds keyboard focus (the user clicked into the preview) */
	guestFocused: boolean;
	/** the "Close on Escape" setting; off for Vim users, where Escape is typing */
	closeOnEscape: boolean;
}

export function shouldDismiss(state: DismissalState, event: DismissalEvent): boolean {
	switch (event) {
		case "close-button":
			// the one unconditional dismissal; every state must stay closable
			return true;
		case "escape":
			return state.closeOnEscape;
		case "pointer-leave":
			// maximize and guest focus each suspend the hover wind-down: the
			// pointer position stops meaning "done looking" the moment the user
			// maximizes or starts typing into the page
			return (
				state.mode === "hover" &&
				!state.pinned &&
				!state.maximized &&
				!state.guestFocused
			);
		case "outside-click":
		case "outside-wheel":
			return !state.pinned;
		case "modifier-release":
			// releasing the trigger keys is a hover-flow gesture; once the user
			// has clicked into the guest to type, holding keys stops making sense
			return !state.pinned && !state.guestFocused;
	}
}
