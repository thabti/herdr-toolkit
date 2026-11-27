// herdr-toolkit's spaces sidebar: Herdr's spaces list (list.js) with worktrees
// shown under their space and a pinned repository per space. The same mod
// draws its popups and dialogs (menus.js), chosen by props.view.
import { View } from "gpui-kit";
import { props } from "herdr";
import { SpacesList } from "./list.js";
import { SpaceMenu, WorktreeMenu, RepoDialog, RemoveDialog, StartPicker } from "./menus.js";

const VIEWS = { menu: SpaceMenu, "worktree-menu": WorktreeMenu, repo: RepoDialog, remove: RemoveDialog, start: StartPicker };

export default class Spaces extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.view = new (VIEWS[p.view] ?? SpacesList)();
    this.view.init(cx, p);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
