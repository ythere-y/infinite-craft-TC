function sameRecipePair(recipe, formula) {
  if (!recipe || !formula) return false;
  const recipeNames = [recipe.a || "", recipe.b || ""].sort().join("\n");
  const formulaNames = [formula.a || "", formula.b || ""].sort().join("\n");
  return recipeNames === formulaNames;
}

export function recipeCommentFor(recipe, openFormula = null) {
  const archived =
    typeof recipe?.comment === "string"
      ? recipe.comment.trim()
      : "";
  if (archived) return archived;

  if (!openFormula?.id || !sameRecipePair(recipe, openFormula)) return null;
  const fallback =
    typeof openFormula.comment === "string"
      ? openFormula.comment.trim()
      : "";
  return fallback || null;
}
