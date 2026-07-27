export const MAX_FAVORITES = 8;

export function normalizeFavoriteIds(ids) {
  if (!Array.isArray(ids)) throw new Error("Favorites must be an array.");
  return [...new Set(ids.map(String))];
}

export function validateFavoriteIds(ids) {
  const favoriteIds = normalizeFavoriteIds(ids);
  if (favoriteIds.length > MAX_FAVORITES) {
    throw new Error(`You can have at most ${MAX_FAVORITES} favorites.`);
  }
  return favoriteIds;
}
