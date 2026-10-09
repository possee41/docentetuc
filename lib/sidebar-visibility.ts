export type SidebarVisibility = { pinned: boolean; hovered: boolean };

export type SidebarVisibilityAction =
  | { type: "toggle-pin" }
  | { type: "hover-enter" }
  | { type: "hover-leave" }
  | { type: "set-open"; open: boolean };

export const sidebarIsOpen = ({ pinned, hovered }: SidebarVisibility) => pinned || hovered;

export function updateSidebarVisibility(state: SidebarVisibility, action: SidebarVisibilityAction): SidebarVisibility {
  switch (action.type) {
    case "toggle-pin": return { pinned: !state.pinned, hovered: false };
    case "hover-enter": return state.pinned || state.hovered ? state : { ...state, hovered: true };
    case "hover-leave": return state.hovered ? { ...state, hovered: false } : state;
    case "set-open": return { pinned: action.open, hovered: false };
  }
}
