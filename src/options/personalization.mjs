import { KEYS } from "../platform/storage.mjs";

export function createPersonalizationView({ elements, getState, actions }) {
  function render() {
    const state = getState();
    elements.favoriteList.replaceChildren();
    const routesById = new Map(state.routes.map((route) => [route.logicalId, route]));
    const favorites = state.favoriteIds.map((id) => routesById.get(id)).filter(Boolean);
    elements.resetFavorites.disabled = state.favoriteIds.length === 0;

    if (!favorites.length) {
      const empty = document.createElement("p");
      empty.className = "favorite-empty";
      empty.textContent = "No favorites yet. Star a destination from the empty search view to see it here.";
      elements.favoriteList.append(empty);
      return;
    }

    for (const route of favorites) {
      const item = document.createElement("div");
      item.className = "favorite-item";
      item.setAttribute("role", "listitem");

      const copy = document.createElement("div");
      copy.className = "favorite-copy";
      const keyword = document.createElement("strong");
      keyword.textContent = route.keyword;
      keyword.title = route.keyword;
      const path = document.createElement("code");
      path.textContent = route.path;
      path.title = route.path;
      copy.append(keyword, path);

      const remove = createTextButton("★", "favorite-remove", async (event) => {
        try {
          await actions.withBusy(event.currentTarget, async () => {
            await actions.persistFavorites(state.favoriteIds.filter((id) => id !== route.logicalId));
            await actions.refresh();
          });
          actions.setStatus(elements.personalizationStatus, `Removed “${route.keyword}” from favorites.`);
        } catch (error) {
          actions.setStatus(elements.personalizationStatus, error.message, true);
        }
      });
      remove.setAttribute("aria-label", `Remove ${route.keyword} from favorites`);
      remove.setAttribute("aria-pressed", "true");
      remove.title = "Remove from favorites";

      item.append(copy, remove);
      elements.favoriteList.append(item);
    }
  }

  elements.resetFavorites.addEventListener("click", async (event) => {
    try {
      await actions.withBusy(event.currentTarget, async () => {
        await actions.clearStored("sync", KEYS.favorites);
        await actions.refresh();
      });
      actions.setStatus(elements.personalizationStatus, "Favorites reset.");
    } catch (error) {
      actions.setStatus(elements.personalizationStatus, error.message, true);
    }
  });

  elements.resetRecents.addEventListener("click", async (event) => {
    try {
      await actions.withBusy(event.currentTarget, async () => {
        await actions.clearStored("local", KEYS.recents);
        await actions.refresh();
      });
      actions.setStatus(elements.personalizationStatus, "Recent destinations reset.");
    } catch (error) {
      actions.setStatus(elements.personalizationStatus, error.message, true);
    }
  });

  return { render };
}

function createTextButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}
